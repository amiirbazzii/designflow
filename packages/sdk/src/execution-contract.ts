// packages/sdk/src/execution-contract.ts
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

/**
 * A bounded, fact-only record of one rejected proposal attempt. Every field
 * is a deterministic validator fact — never raw model output, prompts, or
 * file contents — and every string is truncated before persistence.
 */
export const proposalAttemptDiagnosticSchema = z.object({
  attempt: z.number().int().min(1),
  code: z.string().min(1).max(120),
  message: z.string().max(600),
  path: z.string().max(400).optional(),
  operation: z.string().max(40).optional(),
  targetId: z.string().max(200).optional(),
  targetKind: z.string().max(80).optional(),
  fact: z.string().max(600).optional(),
  compileErrorSummary: z.string().max(1200).optional(),
});

export type ProposalAttemptDiagnostic = z.infer<
  typeof proposalAttemptDiagnosticSchema
>;

const MAX_ATTEMPT_DIAGNOSTICS = 12;

/**
 * Sanitizes untrusted failure metadata into bounded attempt diagnostics.
 * Entries that do not fit the fact-only shape are dropped rather than
 * persisted loosely; strings are truncated to the schema bounds.
 */
export function boundedAttemptDiagnostics(
  value: unknown,
): ProposalAttemptDiagnostic[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const cut = (input: unknown, max: number): string | undefined =>
    typeof input === "string" && input.length > 0
      ? input.slice(0, max)
      : undefined;
  const out: ProposalAttemptDiagnostic[] = [];
  for (const entry of value.slice(0, MAX_ATTEMPT_DIAGNOSTICS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const parsed = proposalAttemptDiagnosticSchema.safeParse({
      attempt: record["attempt"],
      code: cut(record["code"], 120),
      message: cut(record["message"], 600) ?? "",
      ...(cut(record["path"], 400) !== undefined ? { path: cut(record["path"], 400) } : {}),
      ...(cut(record["operation"], 40) !== undefined ? { operation: cut(record["operation"], 40) } : {}),
      ...(cut(record["targetId"], 200) !== undefined ? { targetId: cut(record["targetId"], 200) } : {}),
      ...(cut(record["targetKind"], 80) !== undefined ? { targetKind: cut(record["targetKind"], 80) } : {}),
      ...(cut(record["fact"], 600) !== undefined ? { fact: cut(record["fact"], 600) } : {}),
      ...(cut(record["compileErrorSummary"], 1200) !== undefined
        ? { compileErrorSummary: cut(record["compileErrorSummary"], 1200) }
        : {}),
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * One attempted model candidate as it survives into a persisted failure.
 *
 * The same three-plus-one facts the trace keeps — which model, which stable
 * code, how long it took, and the provider's bounded sanitized reason — so a
 * person reading a failed run can tell "that model id is not available to
 * this account" from "the request timed out" without opening a trace.
 */
export const modelCandidateFailureSchema = z.object({
  model: z.string().min(1).max(160),
  code: z.string().min(1).max(120),
  durationMs: z.number().nonnegative().optional(),
  reason: z.string().min(1).max(300).optional(),
});

export type ModelCandidateFailure = z.infer<typeof modelCandidateFailureSchema>;

const MAX_MODEL_CANDIDATES = 8;

/** Sanitizes untrusted failure metadata into bounded model-candidate facts. */
export function boundedModelCandidates(
  value: unknown,
): ModelCandidateFailure[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: ModelCandidateFailure[] = [];
  for (const entry of value.slice(0, MAX_MODEL_CANDIDATES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const cut = (input: unknown, max: number): string | undefined =>
      typeof input === "string" && input.trim().length > 0 ? input.trim().slice(0, max) : undefined;
    const parsed = modelCandidateFailureSchema.safeParse({
      model: cut(record["model"], 160),
      code: cut(record["code"], 120),
      ...(typeof record["durationMs"] === "number" && Number.isFinite(record["durationMs"]) && record["durationMs"] >= 0
        ? { durationMs: Math.round(record["durationMs"]) }
        : {}),
      ...(cut(record["reason"], 300) !== undefined ? { reason: cut(record["reason"], 300) } : {}),
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out.length > 0 ? out : undefined;
}

export const executionErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  /** Bounded per-attempt validator facts for exhausted proposal loops. */
  attemptDiagnostics: z.array(proposalAttemptDiagnosticSchema).max(12).optional(),
});

export type ExecutionErrorDetail = z.infer<typeof executionErrorSchema>;

export const executionResultSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled", "pending_approval"]),
  artifacts: z.array(artifactRefSchema),
  error: executionErrorSchema.optional(),
});

export type ExecutionResult = z.infer<typeof executionResultSchema>;

// ── Execution Contract Interface ─────────────────────────────────

/**
 * Host-only runtime options for one contract call. Never part of the
 * Zod-validated request, never persisted, never serialized — an
 * `AbortSignal` is process-local runtime state, not workflow data.
 */
export interface ExecutionRuntimeOptions {
  /** Caller-owned root cancellation signal (e.g. the CLI's SIGINT controller). */
  readonly signal?: AbortSignal;
}

export interface ExecutionContract {
  execute(
    request: ExecutionRequest,
    runtime?: ExecutionRuntimeOptions,
  ): Promise<ExecutionResult>;
  resume(
    workflowId: string,
    runtime?: ExecutionRuntimeOptions,
  ): Promise<ExecutionResult>;
  resumeAfterApproval(
    approvalId: string,
    runtime?: ExecutionRuntimeOptions,
  ): Promise<ExecutionResult>;
  /** Resumes using the durable approval bound to an existing execution. */
  resumeAfterConsumedApproval(
    executionId: string,
    runtime?: ExecutionRuntimeOptions,
  ): Promise<ExecutionResult>;
}
