import {
  artifactLineageSchema,
  executionEventSchema,
  readExecutionLineage,
} from "@designflow/sdk";
import type {
  ExecutionContext,
  WorkflowDefinition,
  ArtifactRef,
  ArtifactStore,
  CapabilityContext,
  Logger,
  ExecutionRepository,
  ExecutionCheckpointData,
  ExecutionEventPublisher,
  ExecutionEvent,
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
import { WorkflowCompositionExecutor } from "./composition";
import { DesignFlowError } from "@designflow/sdk";

interface LayerNodeResult {
  readonly artifacts: readonly ArtifactRef[];
  readonly executed: boolean;
  readonly pending: PendingChildApproval | undefined;
}

export class ExecutionEngine {
  private readonly registry: CapabilityRegistry;
  private readonly compiler: WorkflowCompiler;
  private readonly runner: CapabilityRunner;
  private readonly logger: Logger;
  private readonly artifactStore: ArtifactStore;
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
        await this.recordCheckpoint(
          definition.id,
          executionId,
          "waiting_approval",
          {
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

    let targetRecord: { executionId: string; status: string } | null = null;

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

    const abortController = new AbortController();

    const executionContext: ExecutionContext = {
      runId: resumeId,
      workflowId,
      stateRef: "resume",
      artifacts: [],
      metadata: {
        previousExecutionId: targetRecord.executionId,
      },
      signal: abortController.signal,
    };

    return this.run(definition, executionContext);
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
  ): Promise<ExecuteResult> {
    const executedSteps: string[] = [];
    const candidateArtifacts: ArtifactRef[] = [];
    const failedSteps = new Set<string>();
    const failedErrors = new Map<string, unknown>();
    const pendingSteps = new Set<string>();
    const pendingApprovals: PendingChildApproval[] = [];
    const blockedSteps = new Set<string>();
    const allParentArtifacts: ArtifactRef[] = [
      ...context.artifacts,
    ];

    const compositionPath = readExecutionLineage(
      context.metadata,
    ).compositionPath;

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
          const result = compiled.kind === "workflow"
            ? await this.runWorkflowNode(
                compiled.node,
                step.inputMap,
                context,
                compositionPath,
              )
            : await this.runCapabilityNode(
                compiled,
                step.inputMap,
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
    inputMap: Readonly<Record<string, unknown>>,
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
      inputMap,
      capabilityContext,
      {
        timeout: compiled.node.execution?.timeout,
        retryPolicy: compiled.node.execution?.retryPolicy,
      },
    );

    const producedArtifacts: ArtifactRef[] = [];
    if (
      output &&
      typeof output === "object" &&
      "artifactRef" in (output as Record<string, unknown>)
    ) {
      const ref = (output as Record<string, unknown>).artifactRef;
      if (
        typeof ref === "object" &&
        ref !== null &&
        "id" in ref &&
        "type" in ref
      ) {
        producedArtifacts.push(ref as ArtifactRef);
      }
    }

    return {
      artifacts: producedArtifacts,
      executed: true,
      pending: undefined,
    };
  }

  private async runWorkflowNode(
    node: Extract<CompiledNode, { kind: "workflow" }>["node"],
    inputMap: Readonly<Record<string, unknown>>,
    context: ExecutionContext,
    compositionPath: readonly string[],
  ): Promise<LayerNodeResult> {
    if (this.compositionExecutor === undefined) {
      throw new WorkflowResolverNotConfiguredError(node.workflowId, {
        parentExecutionId: context.runId,
        parentWorkflowId: context.workflowId,
        parentNodeId: node.id,
      });
    }

    const outcome = await this.compositionExecutor.execute({
      node,
      inputMap,
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
