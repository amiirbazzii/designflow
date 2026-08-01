// packages/sdk/src/worker-evaluation.ts
import { z } from "zod";

/**
 * A named, typed check a worker's result can be judged against.
 *
 * Metadata only — declaring a criterion does not run it. Whether and how a
 * criterion is evaluated is a product-layer concern (deterministic hooks
 * today, a future evaluation platform later); the schema exists so a worker
 * manifest can name what "good" means without committing to how it is
 * measured yet.
 */
export const workerEvaluationCriterionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    type: z.enum(["boolean", "score", "count"]),
    required: z.boolean(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type WorkerEvaluationCriterion = z.infer<
  typeof workerEvaluationCriterionSchema
>;
