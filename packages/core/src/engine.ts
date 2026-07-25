import {
  executionCheckpointSchema,
  artifactLineageSchema,
} from "@designflow/sdk";
import type {
  ExecutionContext,
  WorkflowDefinition,
  ArtifactRef,
  ArtifactLineage,
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
      const compiled = this.compiler.compile(definition);
      const plan = this.plan(compiled);
      const execution = await this.execute(plan, compiled, context);

      await this.recordCheckpoint(definition.id, executionId, "executing", {
        executedSteps: execution.executedSteps,
      });

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

  private plan(workflow: CompiledWorkflow): ExecutionPlan {
    return {
      workflowId: workflow.id,
      steps: workflow.nodes.map((n) => ({
        nodeId: n.node.id,
        capabilityId: n.node.capabilityId,
        label: n.node.label,
        inputMap: n.node.inputMap,
        dependsOn: n.node.execution?.dependsOn ?? [],
      })),
      totalSteps: workflow.nodes.length,
    };
  }

  private async execute(
    plan: ExecutionPlan,
    workflow: CompiledWorkflow,
    context: ExecutionContext,
  ): Promise<ExecuteResult> {
    const executedSteps: string[] = [];
    const candidateArtifacts: ArtifactRef[] = [];

    const nodeMap = new Map<string, CompiledNode>();
    for (const node of workflow.nodes) {
      nodeMap.set(node.node.id, node);
    }

    for (const step of plan.steps) {
      const compiled = nodeMap.get(step.nodeId);
      if (!compiled) continue;

      const parentArtifactIds = [
        ...context.artifacts.map((a) => a.id),
        ...candidateArtifacts.map((a) => a.id),
      ];
      const parentArtifacts = [
        ...context.artifacts,
        ...candidateArtifacts,
      ];
      const capabilityId = compiled.node.capabilityId;

      const lineageStore: ArtifactStore = {
        save: async (data, metadata) => {
          const lineage = artifactLineageSchema.parse({
            executionId: context.runId,
            workflowId: context.workflowId,
            capabilityId,
            parents: parentArtifactIds,
          });
          return this.artifactStore.save(data, metadata, lineage);
        },
        get: (id) => this.artifactStore.get(id),
        exists: (id) => this.artifactStore.exists(id),
      };

      const output = await compiled.capability.execute(
        {
          executionId: context.runId,
          workflowId: context.workflowId,
          capabilityId,
          logger: this.logger,
          artifactRefs: [...context.artifacts, ...candidateArtifacts],
          parentArtifacts: [...context.artifacts, ...candidateArtifacts],
          artifactStore: lineageStore,
          config: context.metadata,
          signal: context.signal,
        },
        step.inputMap,
      );

      executedSteps.push(step.nodeId);

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
          candidateArtifacts.push(ref as ArtifactRef);
        }
      }
    }

    return { executedSteps, candidateArtifacts };
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
