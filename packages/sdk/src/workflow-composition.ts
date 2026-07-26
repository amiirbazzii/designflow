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
