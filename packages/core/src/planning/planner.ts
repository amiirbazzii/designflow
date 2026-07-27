// packages/core/src/planning/planner.ts
import {
  executionPlanningRequestSchema,
  executionPlanningResultSchema,
} from "@designflow/sdk";
import type {
  ExecutionPlanningRequest,
  ExecutionPlanningResult,
  ExecutionRepository,
  IncrementalExecutionPlanner,
  NodeImpact,
  WorkflowDefinition,
  WorkflowGraph,
} from "@designflow/sdk";
import { ExecutionPlanningError } from "../errors";
import { buildWorkflowGraph } from "./graph";
import { analyzeNodeImpact } from "./impact";

/** Resolves a workflow definition by id. Returns undefined when unknown. */
export type WorkflowDefinitionResolver = (
  workflowId: string,
) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>;

export interface IncrementalExecutionPlannerOptions {
  readonly resolveWorkflow: WorkflowDefinitionResolver;
  /**
   * Used only to confirm that `previousExecutionId` names a real run. Without
   * it, a supplied id is taken at face value.
   */
  readonly executionRepository?: ExecutionRepository;
}

/**
 * Decides the minimum set of nodes that must run after an artifact change.
 *
 * Pure analysis: it resolves a workflow definition, classifies its nodes, and
 * returns the classification. It never executes anything, never touches an
 * artifact, and holds no cache.
 */
export class IncrementalExecutionPlannerService
  implements IncrementalExecutionPlanner
{
  private readonly resolveWorkflow: WorkflowDefinitionResolver;
  private readonly executionRepository: ExecutionRepository | undefined;

  public constructor(options: IncrementalExecutionPlannerOptions) {
    this.resolveWorkflow = options.resolveWorkflow;
    this.executionRepository = options.executionRepository;
  }

  public async planExecution(
    request: ExecutionPlanningRequest,
  ): Promise<ExecutionPlanningResult> {
    const validated = executionPlanningRequestSchema.parse(request);

    const definition = await this.resolveWorkflow(validated.workflowId);

    if (definition === undefined) {
      throw new ExecutionPlanningError(
        `Workflow not found for planning: ${validated.workflowId}`,
        { workflowId: validated.workflowId },
      );
    }

    const graph = buildWorkflowGraph(definition);
    const nodeImpacts = this.analyzeNodeImpact(
      graph,
      validated.changedArtifacts,
    );

    const hasPrevious = await this.hasPreviousExecution(
      validated.previousExecutionId,
    );

    // Nothing is reusable without a previous run to reuse *from*, so the plan
    // degrades to a full execution rather than skipping work that was never
    // done. Conservative in exactly the direction that stays correct.
    const reusableNodes = hasPrevious
      ? this.resolveReusableNodes(graph, nodeImpacts)
      : [];

    const reusable = new Set(reusableNodes);

    const affectedNodes: string[] = [];
    const executionNodes: string[] = [];
    const skippedNodes: string[] = [];

    for (const impact of nodeImpacts) {
      if (impact.affected) affectedNodes.push(impact.nodeId);

      // `executionNodes` and `skippedNodes` partition the workflow: a node is
      // skipped only when it is genuinely reusable, and runs otherwise.
      if (reusable.has(impact.nodeId)) {
        skippedNodes.push(impact.nodeId);
      } else {
        executionNodes.push(impact.nodeId);
      }
    }

    return executionPlanningResultSchema.parse({
      plan: {
        workflowId: validated.workflowId,
        changedArtifacts: validated.changedArtifacts,
        affectedNodes,
        reusableNodes,
        executionNodes,
        skippedNodes,
      },
      nodeImpacts,
    });
  }

  public analyzeNodeImpact(
    workflow: WorkflowGraph,
    changedArtifacts: readonly string[],
  ): readonly NodeImpact[] {
    return analyzeNodeImpact(workflow, changedArtifacts);
  }

  /**
   * Unaffected nodes, in workflow order.
   *
   * Whether a previous execution exists is decided by `planExecution`, which
   * calls this only when one does. Called directly, this reports the nodes
   * that are reusable *if* something exists to reuse.
   */
  public resolveReusableNodes(
    workflow: WorkflowGraph,
    nodeImpacts: readonly NodeImpact[],
  ): readonly string[] {
    const known = new Set(workflow.nodes.map((node) => node.id));

    return nodeImpacts
      .filter((impact) => !impact.affected && known.has(impact.nodeId))
      .map((impact) => impact.nodeId);
  }

  private async hasPreviousExecution(
    previousExecutionId: string | undefined,
  ): Promise<boolean> {
    if (previousExecutionId === undefined) return false;
    if (this.executionRepository === undefined) return true;

    const record = await this.executionRepository.get(previousExecutionId);
    return record !== null;
  }
}
