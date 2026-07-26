import { z } from "zod";
import { artifactRefSchema } from "./schemas";
import {
  executionErrorSchema,
  executionRequestSchema,
} from "./execution-contract";
import type { ExecutionResult } from "./execution-contract";

// ── Workflow Invocation ──────────────────────────────────────────

export const workflowInvocationSchema = z.object({
  workflowId: z.string().min(1),
  input: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type WorkflowInvocation = z.infer<typeof workflowInvocationSchema>;

export const workflowInvocationStatusSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
  "pending_approval",
]);

export type WorkflowInvocationStatus = z.infer<
  typeof workflowInvocationStatusSchema
>;

export const workflowInvocationResultSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  status: workflowInvocationStatusSchema,
  artifacts: z.array(artifactRefSchema),
  error: executionErrorSchema.optional(),
});

export type WorkflowInvocationResult = z.infer<
  typeof workflowInvocationResultSchema
>;

// ── Workflow Invocation Context ──────────────────────────────────

export const compositionPathSchema = z.array(z.string().min(1));

export const workflowInvocationContextSchema = z.object({
  parentExecutionId: z.string().min(1),
  parentWorkflowId: z.string().min(1),
  parentNodeId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type WorkflowInvocationContext = z.infer<
  typeof workflowInvocationContextSchema
>;

// ── Workflow Execution Resolver ──────────────────────────────────

/**
 * Resolves and executes a child workflow on behalf of a parent execution.
 *
 * Implementations live outside the engine so that `@designflow/core` never
 * statically imports concrete workflow packages.
 */
export interface WorkflowExecutionResolver {
  executeWorkflow(
    invocation: WorkflowInvocation,
    context: WorkflowInvocationContext,
  ): Promise<WorkflowInvocationResult>;
}

// ── Execution Lineage ────────────────────────────────────────────

/** Reserved key under which lineage is stored in execution metadata. */
export const EXECUTION_LINEAGE_METADATA_KEY = "lineage";

export const executionLineageSchema = z.object({
  parentExecutionId: z.string().min(1).optional(),
  parentWorkflowId: z.string().min(1).optional(),
  parentNodeId: z.string().min(1).optional(),
  compositionPath: compositionPathSchema.default([]),
});

export type ExecutionLineage = z.infer<typeof executionLineageSchema>;

/** Lineage carried by a child execution; parent identity is mandatory. */
export const childExecutionLineageSchema = z.object({
  parentExecutionId: z.string().min(1),
  parentWorkflowId: z.string().min(1),
  parentNodeId: z.string().min(1),
  compositionPath: compositionPathSchema.default([]),
});

export type ChildExecutionLineage = z.infer<typeof childExecutionLineageSchema>;

export const childExecutionRequestSchema = executionRequestSchema.extend({
  lineage: childExecutionLineageSchema,
});

export type ChildExecutionRequest = z.infer<typeof childExecutionRequestSchema>;

/**
 * Internal execution entry point used for child (composed) executions.
 * Distinct from `ExecutionContract.execute` so that parent-scoped concerns are
 * not replayed against a child execution.
 */
export interface ChildExecutionContract {
  executeChild(request: ChildExecutionRequest): Promise<ExecutionResult>;
}

/**
 * Reads lineage out of an execution metadata bag. Returns an empty lineage
 * (root execution) when absent or malformed.
 */
export function readExecutionLineage(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ExecutionLineage {
  if (metadata === undefined) {
    return { compositionPath: [] };
  }

  const parsed = executionLineageSchema.safeParse(
    metadata[EXECUTION_LINEAGE_METADATA_KEY],
  );

  return parsed.success ? parsed.data : { compositionPath: [] };
}

/** Returns a new metadata bag with the given lineage attached. */
export function withExecutionLineage(
  metadata: Readonly<Record<string, unknown>> | undefined,
  lineage: ExecutionLineage,
): Record<string, unknown> {
  return {
    ...metadata,
    [EXECUTION_LINEAGE_METADATA_KEY]: executionLineageSchema.parse(lineage),
  };
}

// ── Execution Input ──────────────────────────────────────────────

/**
 * Reserved key under which an execution's input is carried in metadata, so it
 * survives persistence and is recoverable on resume.
 */
export const EXECUTION_INPUT_METADATA_KEY = "input";

export function readExecutionInput(
  metadata: Readonly<Record<string, unknown>> | undefined,
): unknown {
  return metadata?.[EXECUTION_INPUT_METADATA_KEY];
}

/**
 * Returns a new metadata bag carrying `input`. An `undefined` input removes
 * the key, so an inherited parent input is never mistaken for a child's own.
 */
export function withExecutionInput(
  metadata: Readonly<Record<string, unknown>> | undefined,
  input: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metadata };

  if (input === undefined) {
    delete next[EXECUTION_INPUT_METADATA_KEY];
  } else {
    next[EXECUTION_INPUT_METADATA_KEY] = input;
  }

  return next;
}

// ── Composition Checkpoint ───────────────────────────────────────

/** Reserved key under which composition resume state is checkpointed. */
export const COMPOSITION_CHECKPOINT_METADATA_KEY = "composition";

export const pendingChildExecutionSchema = z.object({
  nodeId: z.string().min(1),
  childExecutionId: z.string().min(1),
  childWorkflowId: z.string().min(1),
  childArtifacts: z.array(artifactRefSchema).default([]),
});

export type PendingChildExecution = z.infer<typeof pendingChildExecutionSchema>;

/**
 * Node-level state persisted when a parent execution blocks on a child
 * approval, so resuming never re-runs already-completed nodes and never
 * re-invokes the pending child.
 */
export const compositionCheckpointSchema = z.object({
  completedNodeIds: z.array(z.string().min(1)).default([]),
  completedArtifacts: z.array(artifactRefSchema).default([]),
  /** Primary pending node — mirrors `pendingNodes[0]`. */
  pendingNodeId: z.string().min(1),
  childExecutionId: z.string().min(1),
  childWorkflowId: z.string().min(1),
  childArtifacts: z.array(artifactRefSchema).default([]),
  /** Every node blocked on a child approval, including the primary one. */
  pendingNodes: z.array(pendingChildExecutionSchema).min(1),
});

export type CompositionCheckpoint = z.infer<typeof compositionCheckpointSchema>;

export function readCompositionCheckpoint(
  metadata: Readonly<Record<string, unknown>> | undefined,
): CompositionCheckpoint | null {
  if (metadata === undefined) {
    return null;
  }

  const parsed = compositionCheckpointSchema.safeParse(
    metadata[COMPOSITION_CHECKPOINT_METADATA_KEY],
  );

  return parsed.success ? parsed.data : null;
}

export function withCompositionCheckpoint(
  metadata: Readonly<Record<string, unknown>> | undefined,
  checkpoint: CompositionCheckpoint,
): Record<string, unknown> {
  return {
    ...metadata,
    [COMPOSITION_CHECKPOINT_METADATA_KEY]:
      compositionCheckpointSchema.parse(checkpoint),
  };
}
