import { z } from "zod";
import {
  artifactLineageSchema,
  artifactRefSchema,
  compositionCheckpointSchema,
  executionEventSchema,
  readCompositionCheckpoint,
  readExecutionInput,
  readExecutionLineage,
} from "@designflow/sdk";
import type {
  ExecutionContext,
  WorkflowDefinition,
  ArtifactRef,
  ArtifactRegistry,
  ArtifactStore,
  CapabilityContext,
  Logger,
  ExecutionRepository,
  ExecutionCheckpointData,
  ExecutionRecord,
  ExecutionEventPublisher,
  ExecutionEvent,
  CompositionCheckpoint,
  PendingChildExecution,
  WorkflowExecutionResolver,
} from "@designflow/sdk";
import type {
  CompiledNode,
  CompiledWorkflow,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStep,
  PendingChildApproval,
  ValidationIssue,
  ValidationResult,
} from "./types";
import type { ExecuteResult, ApplyResult } from "./lifecycle";
import { WorkflowCompiler } from "./compiler";
import { CapabilityRegistry } from "./registry";
import {
  ExecutionError,
  WorkflowCompositionCycleError,
  WorkflowResolverNotConfiguredError,
} from "./errors";
import { CapabilityRunner } from "./runtime";
import { isArtifactRegistry } from "./artifacts";
import { WorkflowCompositionExecutor } from "./composition";
import { resolveNodeInput } from "./input";
import { DesignFlowError } from "@designflow/sdk";

interface LayerNodeResult {
  readonly artifacts: readonly ArtifactRef[];
  readonly executed: boolean;
  readonly pending: PendingChildApproval | undefined;
}

const capabilityOutputSchema = z.object({
  artifactRef: artifactRefSchema.optional(),
});

/** Pulls a schema-valid artifact reference out of a capability's output. */
function extractProducedArtifacts(output: unknown): ArtifactRef[] {
  const parsed = capabilityOutputSchema.safeParse(output);

  if (!parsed.success || parsed.data.artifactRef === undefined) {
    return [];
  }

  return [parsed.data.artifactRef];
}

/** Artifacts recorded on a completed execution's final checkpoint. */
function readAppliedArtifacts(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ArtifactRef[] {
  const parsed = z
    .array(artifactRefSchema)
    .safeParse(metadata?.appliedArtifacts);

  return parsed.success ? parsed.data : [];
}

export class ExecutionEngine {
  private readonly registry: CapabilityRegistry;
  private readonly compiler: WorkflowCompiler;
  private readonly runner: CapabilityRunner;
  private readonly logger: Logger;
  private readonly artifactStore: ArtifactStore;
  private readonly artifactRegistry: ArtifactRegistry | undefined;
  private readonly executionRepository: ExecutionRepository;
  private readonly eventPublisher: ExecutionEventPublisher;
  private readonly compositionExecutor: WorkflowCompositionExecutor | undefined;

  public constructor(
    registry: CapabilityRegistry,
    logger: Logger,
    artifactStore: ArtifactStore,
    executionRepository: ExecutionRepository,
    eventPublisher: ExecutionEventPublisher,
    workflowExecutionResolver?: WorkflowExecutionResolver,
  ) {
    this.registry = registry;
    this.compiler = new WorkflowCompiler(this.registry);
    this.runner = new CapabilityRunner(eventPublisher);
    this.logger = logger;
    this.artifactStore = artifactStore;
    // Registry-capable stores get artifact identity, versions and provenance
    // recorded automatically; payload-only stores are left untouched.
    this.artifactRegistry = isArtifactRegistry(artifactStore)
      ? artifactStore
      : undefined;
    this.executionRepository = executionRepository;
    this.eventPublisher = eventPublisher;
    this.compositionExecutor = workflowExecutionResolver !== undefined
      ? new WorkflowCompositionExecutor(
          workflowExecutionResolver,
          eventPublisher,
        )
      : undefined;
  }

  public getRegistry(): CapabilityRegistry {
    return this.registry;
  }

  public async run(
    definition: WorkflowDefinition,
    context: ExecutionContext,
    resumeState?: CompositionCheckpoint,
  ): Promise<ExecutionResult> {
    const executionId = context.runId;

    await this.publishEvent(executionId, "execution.started", {
      workflowId: definition.id,
    });

    await this.recordCheckpoint(definition.id, executionId, "started");

    try {
      await this.publishEvent(executionId, "execution.planning", {
        workflowId: definition.id,
      });

      const { compiled, plan } = this.compiler.compile(definition);

      await this.publishEvent(executionId, "execution.executing", {
        workflowId: definition.id,
        layers: plan.layers.length,
      });

      const execution = await this.execute(
        plan,
        compiled,
        context,
        executionId,
        definition.id,
        resumeState,
      );

      if (execution.failedSteps.length > 0) {
        await this.recordCheckpoint(definition.id, executionId, "failed", {
          failedSteps: execution.failedSteps,
        });

        const firstFailedId = execution.failedSteps[0];
        const firstError = firstFailedId !== undefined
          ? execution.failedErrors[firstFailedId]
          : undefined;

        await this.publishEvent(executionId, "execution.failed", {
          workflowId: definition.id,
          failedSteps: execution.failedSteps,
        });

        return {
          workflowId: definition.id,
          success: false,
          artifacts: execution.candidateArtifacts,
          completedSteps: execution.executedSteps,
          failedStep: firstFailedId,
          error: new ExecutionError(
            `Workflow execution failed at step: ${firstFailedId}`,
            {
              workflowId: definition.id,
              failedSteps: execution.failedSteps,
              failedErrors: execution.failedErrors,
              firstError: firstError instanceof Error
                ? firstError.message
                : String(firstError),
            },
          ),
          pendingApproval: undefined,
        };
      }

      // A child execution awaiting approval blocks the parent without failing
      // it: candidate artifacts stay traceable and the run is resumable.
      const firstPending = execution.pendingApprovals[0];
      if (firstPending !== undefined) {
        const pendingNodes: PendingChildExecution[] =
          execution.pendingApprovals.map((pending) => ({
            nodeId: pending.nodeId,
            childExecutionId: pending.childExecutionId,
            childWorkflowId: pending.childWorkflowId,
            childArtifacts: [...pending.childArtifacts],
          }));

        // Node-level state so a later resume skips completed nodes and reuses
        // the existing child execution instead of invoking it again.
        const composition = compositionCheckpointSchema.parse({
          completedNodeIds: execution.executedSteps,
          completedArtifacts: execution.candidateArtifacts,
          pendingNodeId: firstPending.nodeId,
          childExecutionId: firstPending.childExecutionId,
          childWorkflowId: firstPending.childWorkflowId,
          childArtifacts: firstPending.childArtifacts,
          pendingNodes,
        });

        await this.recordCheckpoint(
          definition.id,
          executionId,
          "waiting_approval",
          {
            composition,
            pendingApprovals: execution.pendingApprovals,
            blockedSteps: execution.blockedSteps,
            executedSteps: execution.executedSteps,
          },
        );

        return {
          workflowId: definition.id,
          success: false,
          artifacts: execution.candidateArtifacts,
          completedSteps: execution.executedSteps,
          failedStep: undefined,
          error: undefined,
          pendingApproval: firstPending,
        };
      }

      await this.publishEvent(executionId, "execution.validating", {
        workflowId: definition.id,
      });

      const validation = this.validate(compiled);

      if (!validation.valid) {
        await this.recordCheckpoint(definition.id, executionId, "failed", {
          issues: validation.issues,
        });

        await this.publishEvent(executionId, "execution.failed", {
          workflowId: definition.id,
          reason: "validation_failed",
          issues: validation.issues,
        });

        return {
          workflowId: definition.id,
          success: false,
          artifacts: [],
          completedSteps: execution.executedSteps,
          failedStep: undefined,
          error: new ExecutionError("Workflow validation failed", {
            issues: validation.issues,
          }),
          pendingApproval: undefined,
        };
      }

      await this.publishEvent(executionId, "execution.applying", {
        workflowId: definition.id,
      });

      const applyResult = this.apply(compiled, execution.candidateArtifacts);

      await this.recordCheckpoint(definition.id, executionId, "completed", {
        appliedArtifacts: applyResult.appliedArtifacts,
      });

      await this.publishEvent(executionId, "execution.completed", {
        workflowId: definition.id,
        artifactCount: applyResult.appliedArtifacts.length,
      });

      return {
        workflowId: definition.id,
        success: applyResult.committed,
        artifacts: applyResult.appliedArtifacts,
        completedSteps: execution.executedSteps,
        failedStep: undefined,
        error: undefined,
        pendingApproval: undefined,
      };
    } catch (error) {
      await this.recordCheckpoint(definition.id, executionId, "failed", {
        error: String(error),
      });

      await this.publishEvent(executionId, "execution.failed", {
        workflowId: definition.id,
        error: String(error),
      });

      const normalizedError = error instanceof DesignFlowError
        ? error
        : new ExecutionError("Unexpected execution failure", {
            workflowId: definition.id,
            cause: error instanceof Error ? error.message : String(error),
          });

      return {
        workflowId: definition.id,
        success: false,
        artifacts: [],
        completedSteps: [],
        failedStep: undefined,
        error: normalizedError,
        pendingApproval: undefined,
      };
    }
  }

  public async resume(
    definition: WorkflowDefinition,
    workflowId: string,
    executionId?: string,
  ): Promise<ExecutionResult> {
    const resumeId = executionId ?? crypto.randomUUID();

    const executionRecords = await this.executionRepository.list(workflowId);

    let targetRecord: ExecutionRecord | null = null;

    if (executionId) {
      const found = executionRecords.find(
        (r) => r.executionId === executionId,
      );
      if (found) {
        targetRecord = found;
      }
    }

    if (targetRecord === null && executionRecords.length > 0) {
      const sorted = [...executionRecords].sort(
        (a, b) => b.startedAt - a.startedAt,
      );
      targetRecord = sorted[0] ?? null;
    }

    if (targetRecord === null) {
      throw new ExecutionError("No checkpoint found to resume from", {
        workflowId,
      });
    }

    if (targetRecord.status === "completed") {
      const checkpoint = await this.executionRepository.getLatestCheckpoint(
        targetRecord.executionId,
      );

      const rawArtifacts = checkpoint?.metadata?.appliedArtifacts;
      const completedArtifacts: ArtifactRef[] = Array.isArray(rawArtifacts)
        ? rawArtifacts.filter(
            (a): a is ArtifactRef =>
              typeof a === "object" &&
              a !== null &&
              "id" in a &&
              "type" in a,
          )
        : [];

      return {
        workflowId,
        success: true,
        artifacts: completedArtifacts,
        completedSteps: [],
        failedStep: undefined,
        error: undefined,
        pendingApproval: undefined,
      };
    }

    if (targetRecord.status === "failed" || targetRecord.status === "cancelled") {
      return {
        workflowId,
        success: false,
        artifacts: [],
        completedSteps: [],
        failedStep: undefined,
        error: new ExecutionError(
          `Workflow previously ${targetRecord.status}, cannot resume`,
          {
            workflowId,
            previousExecutionId: targetRecord.executionId,
          },
        ),
        pendingApproval: undefined,
      };
    }

    // Composition state is read before run(), which overwrites the
    // waiting_approval checkpoint with a fresh "started" one.
    const checkpoint = await this.executionRepository.getLatestCheckpoint(
      targetRecord.executionId,
    );
    const resumeState = readCompositionCheckpoint(checkpoint?.metadata);

    const abortController = new AbortController();

    const executionContext: ExecutionContext = {
      runId: resumeId,
      workflowId,
      stateRef: "resume",
      artifacts: [],
      metadata: {
        ...targetRecord.metadata,
        previousExecutionId: targetRecord.executionId,
      },
      signal: abortController.signal,
    };

    return this.run(
      definition,
      executionContext,
      resumeState ?? undefined,
    );
  }

  private async publishEvent(
    executionId: string,
    type: ExecutionEvent["type"],
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const event = executionEventSchema.parse({
      id: crypto.randomUUID(),
      executionId,
      type,
      timestamp: Date.now(),
      payload,
    });
    await this.eventPublisher.publish(event);
  }

  private async recordCheckpoint(
    workflowId: string,
    executionId: string,
    phase: string,
    additional?: Record<string, unknown>,
  ): Promise<void> {
    const timestamp = Date.now();
    const metadata = { ...additional, executionId, phase };

    const checkpoint: ExecutionCheckpointData = {
      executionId,
      phase,
      timestamp,
      state: metadata,
      metadata,
    };

    try {
      await this.executionRepository.saveCheckpoint(executionId, checkpoint);
    } catch (error) {
      throw new ExecutionError("Failed to persist checkpoint", {
        workflowId,
        executionId,
        phase,
        error,
      });
    }
  }

  private async execute(
    plan: ExecutionPlan,
    workflow: CompiledWorkflow,
    context: ExecutionContext,
    executionId: string,
    workflowId: string,
    resumeState?: CompositionCheckpoint,
  ): Promise<ExecuteResult> {
    // Resuming replays the plan but re-executes nothing that already
    // finished: completed nodes are skipped and their artifacts are restored.
    const alreadyCompleted = new Set(resumeState?.completedNodeIds ?? []);
    const restoredArtifacts = resumeState?.completedArtifacts ?? [];

    const resumedChildren = new Map<string, PendingChildExecution>(
      (resumeState?.pendingNodes ?? []).map((pending) => [
        pending.nodeId,
        pending,
      ]),
    );

    const executedSteps: string[] = [...alreadyCompleted];
    const candidateArtifacts: ArtifactRef[] = [...restoredArtifacts];
    const failedSteps = new Set<string>();
    const failedErrors = new Map<string, unknown>();
    const pendingSteps = new Set<string>();
    const pendingApprovals: PendingChildApproval[] = [];
    const blockedSteps = new Set<string>();
    const allParentArtifacts: ArtifactRef[] = [
      ...context.artifacts,
      ...restoredArtifacts,
    ];

    const compositionPath = readExecutionLineage(
      context.metadata,
    ).compositionPath;

    const workflowInput = readExecutionInput(context.metadata);

    const nodeMap = new Map<string, CompiledNode>();
    for (const node of workflow.nodes) {
      nodeMap.set(node.node.id, node);
    }

    const stepMap = new Map<string, ExecutionStep>();
    for (const step of plan.steps) {
      stepMap.set(step.nodeId, step);
    }

    for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex++) {
      const layer = plan.layers[layerIndex];
      if (!layer) continue;

      const activeNodes: string[] = [];

      for (const nodeId of layer.nodeIds) {
        const step = stepMap.get(nodeId);
        if (!step) continue;

        if (alreadyCompleted.has(nodeId)) continue;

        if (step.dependsOn.some((dep) => failedSteps.has(dep))) {
          failedSteps.add(nodeId);
          continue;
        }

        if (
          step.dependsOn.some(
            (dep) => pendingSteps.has(dep) || blockedSteps.has(dep),
          )
        ) {
          blockedSteps.add(nodeId);
          continue;
        }

        activeNodes.push(nodeId);
      }

      await this.recordCheckpoint(workflowId, executionId, "executing", {
        currentLayer: layerIndex + 1,
        totalLayers: plan.layers.length,
        executedSteps: executedSteps.length,
      });

      if (activeNodes.length === 0) continue;

      const layerResultMap = new Map<string, LayerNodeResult>();

      // Errors that invalidate the workflow structure itself (composition
      // cycles, missing resolver) abort the whole run instead of degrading
      // into a single-step failure.
      let structuralError: unknown;

      const layerPromises = activeNodes.map(async (nodeId) => {
        const compiled = nodeMap.get(nodeId);
        const step = stepMap.get(nodeId);
        if (!compiled || !step) return;

        try {
          const nodeInput = resolveNodeInput(step.inputMap, workflowInput);

          const result = compiled.kind === "workflow"
            ? await this.runWorkflowNode(
                compiled.node,
                nodeInput,
                context,
                compositionPath,
                resumedChildren.get(nodeId),
              )
            : await this.runCapabilityNode(
                compiled,
                nodeInput,
                context,
                allParentArtifacts,
              );

          layerResultMap.set(nodeId, result);
        } catch (error) {
          if (
            error instanceof WorkflowCompositionCycleError ||
            error instanceof WorkflowResolverNotConfiguredError
          ) {
            structuralError = error;
          }

          failedSteps.add(nodeId);
          failedErrors.set(nodeId, error);
          layerResultMap.set(nodeId, {
            artifacts: [],
            executed: false,
            pending: undefined,
          });
        }
      });

      await Promise.all(layerPromises);

      if (structuralError !== undefined) {
        throw structuralError;
      }

      for (const nodeId of activeNodes) {
        const result = layerResultMap.get(nodeId);
        if (!result) {
          failedSteps.add(nodeId);
          continue;
        }

        if (result.pending !== undefined) {
          pendingSteps.add(nodeId);
          pendingApprovals.push(result.pending);
        } else if (result.executed) {
          executedSteps.push(nodeId);
        }

        // Artifacts already produced by a child remain traceable even when the
        // child did not reach a terminal completed state.
        for (const artifact of result.artifacts) {
          candidateArtifacts.push(artifact);
          allParentArtifacts.push(artifact);
        }
      }
    }

    return {
      executedSteps,
      candidateArtifacts,
      failedSteps: Array.from(failedSteps),
      failedErrors: Object.fromEntries(failedErrors),
      pendingApprovals,
      blockedSteps: Array.from(blockedSteps),
    };
  }

  private async runCapabilityNode(
    compiled: Extract<CompiledNode, { kind: "capability" }>,
    input: unknown,
    context: ExecutionContext,
    parentArtifacts: readonly ArtifactRef[],
  ): Promise<LayerNodeResult> {
    const capabilityId = compiled.node.capabilityId;
    const snapshot = [...parentArtifacts];
    const parentArtifactIds = snapshot.map((a) => a.id);

    const lineageStore: ArtifactStore = {
      save: async (data: unknown, metadata?: Record<string, unknown>) => {
        const lineage = artifactLineageSchema.parse({
          executionId: context.runId,
          workflowId: context.workflowId,
          capabilityId,
          parents: parentArtifactIds,
        });
        return this.artifactStore.save(data, metadata, lineage);
      },
      get: (id: string) => this.artifactStore.get(id),
      exists: (id: string) => this.artifactStore.exists(id),
    };

    const capabilityContext: CapabilityContext = {
      executionId: context.runId,
      workflowId: context.workflowId,
      capabilityId,
      logger: this.logger,
      artifactRefs: snapshot,
      parentArtifacts: snapshot,
      artifactStore: lineageStore,
      config: context.metadata,
      signal: context.signal,
    };

    const output = await this.runner.run(
      compiled.capability,
      input,
      capabilityContext,
      {
        timeout: compiled.node.execution?.timeout,
        retryPolicy: compiled.node.execution?.retryPolicy,
      },
    );

    const produced = extractProducedArtifacts(output);

    for (const artifact of produced) {
      await this.registerProducedArtifact(
        artifact,
        context,
        capabilityId,
        parentArtifactIds,
      );
    }

    return {
      artifacts: produced,
      executed: true,
      pending: undefined,
    };
  }

  /**
   * Resolves a capability's `ArtifactRef` against the registry, registering it
   * with provenance the first time it is seen, and linking it to the artifacts
   * it was built from.
   *
   * Only identity, version and provenance are recorded — the payload stays
   * behind `ArtifactStore` and never enters a checkpoint.
   */
  private async registerProducedArtifact(
    artifact: ArtifactRef,
    context: ExecutionContext,
    capabilityId: string,
    parentArtifactIds: readonly string[],
  ): Promise<void> {
    const registry = this.artifactRegistry;
    if (registry === undefined) return;

    const existing = await registry.getArtifact(artifact.id);

    if (existing === null) {
      await registry.createArtifact({
        id: artifact.id,
        type: artifact.type,
        metadata: artifact.metadata ?? {},
        provenance: {
          executionId: context.runId,
          workflowId: context.workflowId,
          capabilityId,
        },
      });
    }

    for (const parentId of parentArtifactIds) {
      if (parentId === artifact.id) continue;
      if ((await registry.getArtifact(parentId)) === null) continue;

      await registry.addRelation({
        sourceArtifactId: artifact.id,
        targetArtifactId: parentId,
        relation: "derived_from",
      });
    }
  }

  private async runWorkflowNode(
    node: Extract<CompiledNode, { kind: "workflow" }>["node"],
    input: unknown,
    context: ExecutionContext,
    compositionPath: readonly string[],
    resumedChild?: PendingChildExecution,
  ): Promise<LayerNodeResult> {
    // On resume the child already exists — reuse its outcome rather than
    // starting a second child execution (and a second approval request).
    if (resumedChild !== undefined) {
      return this.resumeChildNode(node, context, resumedChild);
    }

    if (this.compositionExecutor === undefined) {
      throw new WorkflowResolverNotConfiguredError(node.workflowId, {
        parentExecutionId: context.runId,
        parentWorkflowId: context.workflowId,
        parentNodeId: node.id,
      });
    }

    const outcome = await this.compositionExecutor.execute({
      node,
      input,
      parentExecutionId: context.runId,
      parentWorkflowId: context.workflowId,
      compositionPath,
      metadata: context.metadata,
    });

    if (outcome.status === "pending_approval") {
      return {
        artifacts: outcome.artifacts,
        executed: false,
        pending: {
          nodeId: node.id,
          childWorkflowId: outcome.childWorkflowId,
          childExecutionId: outcome.childExecutionId,
          childArtifacts: outcome.artifacts,
          message:
            outcome.error?.message ??
            `Child workflow ${outcome.childWorkflowId} is awaiting approval`,
        },
      };
    }

    if (outcome.status !== "completed") {
      throw new ExecutionError(
        `Child workflow ${outcome.status}: ${outcome.childWorkflowId}`,
        {
          parentExecutionId: context.runId,
          parentWorkflowId: context.workflowId,
          parentNodeId: node.id,
          childExecutionId: outcome.childExecutionId,
          childWorkflowId: outcome.childWorkflowId,
          childStatus: outcome.status,
          childError: outcome.error,
          childArtifacts: outcome.artifacts.map((a) => a.id),
        },
      );
    }

    return {
      artifacts: outcome.artifacts,
      executed: true,
      pending: undefined,
    };
  }

  /**
   * Resolves a workflow node from the child execution that was already
   * started for it, without re-invoking the resolver.
   */
  private async resumeChildNode(
    node: Extract<CompiledNode, { kind: "workflow" }>["node"],
    context: ExecutionContext,
    resumedChild: PendingChildExecution,
  ): Promise<LayerNodeResult> {
    const payload = {
      parentExecutionId: context.runId,
      parentWorkflowId: context.workflowId,
      parentNodeId: node.id,
      childWorkflowId: resumedChild.childWorkflowId,
      childExecutionId: resumedChild.childExecutionId,
      resumed: true,
    };

    const record = await this.executionRepository.get(
      resumedChild.childExecutionId,
    );

    if (record === null) {
      throw new ExecutionError(
        `Child execution record not found on resume: ${resumedChild.childExecutionId}`,
        payload,
      );
    }

    switch (record.status) {
      case "completed": {
        const checkpoint = await this.executionRepository.getLatestCheckpoint(
          resumedChild.childExecutionId,
        );
        const artifacts = readAppliedArtifacts(checkpoint?.metadata);

        await this.publishEvent(
          context.runId,
          "workflow.child_completed",
          { ...payload, artifactCount: artifacts.length },
        );

        return { artifacts, executed: true, pending: undefined };
      }

      case "failed":
      case "cancelled": {
        await this.publishEvent(context.runId, "workflow.child_failed", {
          ...payload,
          status: record.status,
        });

        throw new ExecutionError(
          `Child workflow ${record.status}: ${resumedChild.childWorkflowId}`,
          {
            ...payload,
            childStatus: record.status,
            childArtifacts: resumedChild.childArtifacts.map((a) => a.id),
          },
        );
      }

      case "running":
      case "waiting_approval":
        return {
          artifacts: resumedChild.childArtifacts,
          executed: false,
          pending: {
            nodeId: node.id,
            childWorkflowId: resumedChild.childWorkflowId,
            childExecutionId: resumedChild.childExecutionId,
            childArtifacts: resumedChild.childArtifacts,
            message: `Child workflow ${resumedChild.childWorkflowId} is still awaiting approval`,
          },
        };
    }
  }

  private validate(workflow: CompiledWorkflow): ValidationResult {
    const issues: ValidationIssue[] = [];

    for (const node of workflow.nodes) {
      const deps = node.node.execution?.dependsOn ?? [];
      for (const dep of deps) {
        const depExists = workflow.nodes.some((n) => n.node.id === dep);
        if (!depExists) {
          issues.push({
            nodeId: node.node.id,
            kind: node.kind,
            targetId: node.kind === "workflow"
              ? node.node.workflowId
              : node.node.capabilityId,
            message: `Missing dependency: ${dep}`,
            severity: "error",
          });
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }

  private apply(
    _workflow: CompiledWorkflow,
    artifacts: readonly ArtifactRef[],
  ): ApplyResult {
    return {
      appliedArtifacts: artifacts,
      committed: true,
    };
  }
}
