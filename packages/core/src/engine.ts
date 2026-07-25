import {
  executionCheckpointSchema,
  artifactLineageSchema,
} from "@designflow/sdk";
import type {
  ExecutionContext,
  WorkflowDefinition,
  ArtifactRef,
  ArtifactStore,
  Logger,
  StateStore,
  ExecutionPhase,
} from "@designflow/sdk";
import type {
  CompiledNode,
  CompiledWorkflow,
  ExecutionPlan,
  ExecutionResult,
  ValidationIssue,
  ValidationResult,
} from "./types";
import type { ExecuteResult, ApplyResult } from "./lifecycle";
import { WorkflowCompiler } from "./compiler";
import { CapabilityRegistry } from "./registry";
import { ExecutionError } from "./errors";

export class ExecutionEngine {
  private readonly registry: CapabilityRegistry;
  private readonly compiler: WorkflowCompiler;
  private readonly logger: Logger;
  private readonly artifactStore: ArtifactStore;
  private readonly stateStore: StateStore;

  public constructor(
    registry: CapabilityRegistry,
    logger: Logger,
    artifactStore: ArtifactStore,
    stateStore: StateStore,
  ) {
    this.registry = registry;
    this.compiler = new WorkflowCompiler(this.registry);
    this.logger = logger;
    this.artifactStore = artifactStore;
    this.stateStore = stateStore;
  }

  public getRegistry(): CapabilityRegistry {
    return this.registry;
  }

  public async run(
    definition: WorkflowDefinition,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const executionId = context.runId;

    await this.recordCheckpoint(definition.id, executionId, "started");

    try {
      const { compiled, plan } = this.compiler.compile(definition);
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

        return {
          workflowId: definition.id,
          success: false,
          artifacts: execution.candidateArtifacts,
          completedSteps: execution.executedSteps,
          failedStep: execution.failedSteps[0],
          error: new ExecutionError(
            `Workflow execution failed at step: ${execution.failedSteps[0]}`,
            {
              workflowId: definition.id,
              failedSteps: execution.failedSteps,
            },
          ),
        };
      }

      const validation = this.validate(compiled);

      if (!validation.valid) {
        await this.recordCheckpoint(definition.id, executionId, "failed", {
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
        };
      }

      const applyResult = this.apply(compiled, execution.candidateArtifacts);

      await this.recordCheckpoint(definition.id, executionId, "completed", {
        appliedArtifacts: applyResult.appliedArtifacts,
      });

      return {
        workflowId: definition.id,
        success: applyResult.committed,
        artifacts: applyResult.appliedArtifacts,
        completedSteps: execution.executedSteps,
        failedStep: undefined,
        error: undefined,
      };
    } catch (error) {
      await this.recordCheckpoint(definition.id, executionId, "failed", {
        error: String(error),
      });

      return {
        workflowId: definition.id,
        success: false,
        artifacts: [],
        completedSteps: [],
        failedStep: undefined,
        error,
      };
    }
  }

  public async resume(
    definition: WorkflowDefinition,
    workflowId: string,
  ): Promise<ExecutionResult> {
    const latest = await this.stateStore.getLatestCheckpoint(workflowId);

    if (latest === null) {
      throw new ExecutionError("No checkpoint found to resume from", {
        workflowId,
      });
    }

    const checkpoint = executionCheckpointSchema.parse(latest.state);

    if (checkpoint.phase === "completed") {
      const rawArtifacts = checkpoint.metadata?.appliedArtifacts;
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
      };
    }

    if (checkpoint.phase === "failed") {
      return {
        workflowId,
        success: false,
        artifacts: [],
        completedSteps: [],
        failedStep: undefined,
        error: new ExecutionError(
          "Workflow previously failed, cannot resume",
          {
            workflowId,
            previousExecutionId: checkpoint.executionId,
          },
        ),
      };
    }

    const abortController = new AbortController();

    const executionContext: ExecutionContext = {
      runId: crypto.randomUUID(),
      workflowId,
      stateRef: "resume",
      artifacts: [],
      metadata: {
        resumedFromCheckpoint: latest.checkpointId,
        previousExecutionId: checkpoint.executionId,
      },
      signal: abortController.signal,
    };

    return this.run(definition, executionContext);
  }

  private async recordCheckpoint(
    workflowId: string,
    executionId: string,
    phase: ExecutionPhase,
    additional?: Record<string, unknown>,
  ): Promise<void> {
    const checkpointId = `${executionId}-${phase}`;
    const timestamp = Date.now();
    const metadata = { ...additional, executionId, phase };

    const checkpoint = executionCheckpointSchema.parse({
      workflowId,
      executionId,
      phase,
      timestamp,
      stateRef: checkpointId,
      metadata,
    });

    try {
      await this.stateStore.saveCheckpoint(
        workflowId,
        checkpointId,
        checkpoint,
        { phase, executionId },
        timestamp,
      );
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
    const allParentArtifacts: ArtifactRef[] = [
      ...context.artifacts,
    ];

    const nodeMap = new Map<string, CompiledNode>();
    for (const node of workflow.nodes) {
      nodeMap.set(node.node.id, node);
    }

    const stepMap = new Map<string, (typeof plan.steps)[number]>();
    for (const step of plan.steps) {
      stepMap.set(step.nodeId, step);
    }

    for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex++) {
      const layer = plan.layers[layerIndex];
      if (!layer) continue;

      const blockedNodes = new Set<string>();
      const activeNodes: string[] = [];

      for (const nodeId of layer.nodeIds) {
        const step = stepMap.get(nodeId);
        if (!step) continue;

        const hasFailedDep = step.dependsOn.some((dep) =>
          failedSteps.has(dep),
        );
        if (hasFailedDep) {
          blockedNodes.add(nodeId);
        } else {
          activeNodes.push(nodeId);
        }
      }

      for (const nodeId of blockedNodes) {
        failedSteps.add(nodeId);
      }

      await this.recordCheckpoint(workflowId, executionId, "executing", {
        currentLayer: layerIndex + 1,
        totalLayers: plan.layers.length,
        executedSteps: executedSteps.length,
      });

      if (activeNodes.length === 0) continue;

      const layerResultMap = new Map<
        string,
        { artifacts: ArtifactRef[]; executed: boolean }
      >();

      const layerPromises = activeNodes.map(async (nodeId) => {
        const compiled = nodeMap.get(nodeId);
        if (!compiled) return;

        const capabilityId = compiled.node.capabilityId;

        const parentArtifactIds = allParentArtifacts.map((a) => a.id);

        const lineageStore: ArtifactStore = {
          save: async (
            data: unknown,
            metadata?: Record<string, unknown>,
          ) => {
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

        try {
          const step = stepMap.get(nodeId)!;
          const output = await compiled.capability.execute(
            {
              executionId: context.runId,
              workflowId: context.workflowId,
              capabilityId,
              logger: this.logger,
              artifactRefs: [...allParentArtifacts],
              parentArtifacts: [...allParentArtifacts],
              artifactStore: lineageStore,
              config: context.metadata,
              signal: context.signal,
            },
            step.inputMap,
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

          layerResultMap.set(nodeId, {
            artifacts: producedArtifacts,
            executed: true,
          });
        } catch (error) {
          failedSteps.add(nodeId);
          layerResultMap.set(nodeId, {
            artifacts: [],
            executed: false,
          });
        }
      });

      await Promise.all(layerPromises);

      for (const nodeId of activeNodes) {
        const result = layerResultMap.get(nodeId);
        if (!result) {
          failedSteps.add(nodeId);
          continue;
        }

        if (result.executed) {
          executedSteps.push(nodeId);
        }
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
            capabilityId: node.node.capabilityId,
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