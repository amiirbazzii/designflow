import { z } from "zod";
import { artifactRefSchema } from "./schemas";

// ── Execution Request ────────────────────────────────────────────

export const executionRequestOptionsSchema = z.object({
  dryRun: z.boolean().optional(),
  resume: z.boolean().optional(),
});

export type ExecutionRequestOptions = z.infer<typeof executionRequestOptionsSchema>;

export const executionRequestSchema = z.object({
  workflowId: z.string().min(1),
  input: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  options: executionRequestOptionsSchema.optional(),
});

export type ExecutionRequest = z.infer<typeof executionRequestSchema>;

// ── Execution Result ─────────────────────────────────────────────

export const executionErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export type ExecutionErrorDetail = z.infer<typeof executionErrorSchema>;

export const executionResultSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  artifacts: z.array(artifactRefSchema),
  error: executionErrorSchema.optional(),
});

export type ExecutionResult = z.infer<typeof executionResultSchema>;

// ── Execution Contract Interface ─────────────────────────────────

export interface ExecutionContract {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  resume(workflowId: string): Promise<ExecutionResult>;
}
