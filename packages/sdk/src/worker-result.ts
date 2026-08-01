// packages/sdk/src/worker-result.ts
import { z } from "zod";

/**
 * A product-facing outcome.
 *
 * The shape a UI client renders and the shape an engine execution actually
 * produces are different on purpose: this schema names no agent id, no
 * workflow id, no prompt or completion, no private reasoning. A mapper in the
 * product layer builds one of these from an `ExecutionRecord` and its
 * artifacts; nothing here is ever constructed from raw engine state directly.
 */

export const workerResultOutputSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.string().min(1),
    /** A short, safe description — never the artifact's raw payload. */
    summary: z.string(),
  })
  .strict();

export type WorkerResultOutput = z.infer<typeof workerResultOutputSchema>;

export const workerEvaluationResultSchema = z
  .object({
    criterionId: z.string().min(1),
    /** Present only when the criterion could be evaluated deterministically. */
    value: z.union([z.boolean(), z.number()]).optional(),
    satisfied: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict();

export type WorkerEvaluationResult = z.infer<
  typeof workerEvaluationResultSchema
>;

export const workerEvaluationSummarySchema = z
  .object({
    results: z.array(workerEvaluationResultSchema).default([]),
    /** How many required criteria were satisfied, out of how many apply. */
    requiredSatisfied: z.number().int().min(0),
    requiredTotal: z.number().int().min(0),
  })
  .strict();

export type WorkerEvaluationSummary = z.infer<
  typeof workerEvaluationSummarySchema
>;

export const workerResultStatusSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
]);

export type WorkerResultStatus = z.infer<typeof workerResultStatusSchema>;

export const workerResultSchema = z
  .object({
    id: z.string().min(1),
    workerId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    status: workerResultStatusSchema,
    startedAt: z.string().min(1),
    completedAt: z.string().min(1).optional(),
    summary: z.string(),
    outputs: z.array(workerResultOutputSchema).default([]),
    /**
     * Present so a result can be looked up again — never an id for anything
     * internal beyond "the record this came from".
     */
    executionId: z.string().min(1).optional(),
    evaluation: workerEvaluationSummarySchema.optional(),
    /** e.g. `{ legacy: true }` for an execution with no discoverable worker. */
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type WorkerResult = z.infer<typeof workerResultSchema>;
