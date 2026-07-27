import { z } from "zod";

// ── Node Impact ──────────────────────────────────────────────────

export const nodeImpactReasonSchema = z.enum([
  /** The node itself produces one of the changed artifacts. */
  "artifact_changed",
  /** A node this one depends on is affected. */
  "dependency_changed",
  /** Neither, so the node's prior output still holds. */
  "unaffected",
]);

export type NodeImpactReason = z.infer<typeof nodeImpactReasonSchema>;

export const nodeImpactSchema = z.object({
  nodeId: z.string().min(1),
  affected: z.boolean(),
  reason: nodeImpactReasonSchema,
});

export type NodeImpact = z.infer<typeof nodeImpactSchema>;

// ── Incremental Plan ─────────────────────────────────────────────

/**
 * The classification of a workflow's nodes for one change set.
 *
 * `executionNodes` and `skippedNodes` partition the workflow: every node
 * appears in exactly one of them. `affectedNodes` and `reusableNodes` explain
 * *why* — a node may need running because it is affected, or because nothing
 * exists to reuse.
 */
export const incrementalExecutionPlanSchema = z.object({
  workflowId: z.string().min(1),
  changedArtifacts: z.array(z.string().min(1)),
  /** Nodes invalidated by the change set, directly or transitively. */
  affectedNodes: z.array(z.string().min(1)),
  /** Unaffected nodes whose previous output could stand in for a rerun. */
  reusableNodes: z.array(z.string().min(1)),
  /** Nodes that must run. */
  executionNodes: z.array(z.string().min(1)),
  /** Nodes that may be left out of the run. */
  skippedNodes: z.array(z.string().min(1)),
});

export type IncrementalExecutionPlan = z.infer<
  typeof incrementalExecutionPlanSchema
>;

// ── Planning Request / Result ────────────────────────────────────

export const executionPlanningRequestSchema = z.object({
  workflowId: z.string().min(1),
  changedArtifacts: z.array(z.string().min(1)).default([]),
  /**
   * The run whose output would be reused. Without it nothing is reusable, so
   * the plan degrades to a full execution.
   */
  previousExecutionId: z.string().min(1).optional(),
});

export type ExecutionPlanningRequest = z.infer<
  typeof executionPlanningRequestSchema
>;

export const executionPlanningResultSchema = z.object({
  plan: incrementalExecutionPlanSchema,
  nodeImpacts: z.array(nodeImpactSchema),
});

export type ExecutionPlanningResult = z.infer<
  typeof executionPlanningResultSchema
>;

// ── Workflow Graph ───────────────────────────────────────────────

/**
 * A workflow node reduced to what planning needs: who it waits for, and which
 * artifacts it is declared to produce.
 */
export const workflowGraphNodeSchema = z.object({
  id: z.string().min(1),
  dependencies: z.array(z.string().min(1)).default([]),
  produces: z.array(z.string().min(1)).default([]),
});

export type WorkflowGraphNode = z.infer<typeof workflowGraphNodeSchema>;

export const workflowGraphSchema = z.object({
  workflowId: z.string().min(1),
  nodes: z.array(workflowGraphNodeSchema),
});

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

// ── Planner Contract ─────────────────────────────────────────────

/**
 * Decides the minimum set of nodes that must run after an artifact change.
 *
 * Analysis only. A planner never executes a workflow, mutates an artifact,
 * reads or writes a cache, or decides what may be reused in place of a node's
 * output — it reports which nodes *could* be reused and leaves the policy to
 * a `CapabilityReuseResolver`.
 */
export interface IncrementalExecutionPlanner {
  planExecution(
    request: ExecutionPlanningRequest,
  ): Promise<ExecutionPlanningResult>;

  analyzeNodeImpact(
    workflow: WorkflowGraph,
    changedArtifacts: readonly string[],
  ): readonly NodeImpact[];

  resolveReusableNodes(
    workflow: WorkflowGraph,
    nodeImpacts: readonly NodeImpact[],
  ): readonly string[];
}

// ── Changed Artifacts Metadata ───────────────────────────────────

/**
 * Reserved key under which a run's change set travels in execution metadata,
 * so it is persisted with the record and survives a resume.
 */
export const CHANGED_ARTIFACTS_METADATA_KEY = "changedArtifacts";

const changedArtifactsSchema = z.array(z.string().min(1));

export function readChangedArtifacts(
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const parsed = changedArtifactsSchema.safeParse(
    metadata?.[CHANGED_ARTIFACTS_METADATA_KEY],
  );

  return parsed.success ? parsed.data : [];
}

/**
 * Returns a new metadata bag carrying `changedArtifacts`. An empty set removes
 * the key, so a stale change set is never inherited.
 */
export function withChangedArtifacts(
  metadata: Readonly<Record<string, unknown>> | undefined,
  changedArtifacts: readonly string[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metadata };

  if (changedArtifacts.length === 0) {
    delete next[CHANGED_ARTIFACTS_METADATA_KEY];
  } else {
    next[CHANGED_ARTIFACTS_METADATA_KEY] =
      changedArtifactsSchema.parse(changedArtifacts);
  }

  return next;
}
