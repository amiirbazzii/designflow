// packages/sdk/src/trace.ts
import { z } from "zod";
import { modelUsageSchema } from "./model";

/**
 * A trace is the record that an AI decision happened, and what it decided.
 *
 * It is deliberately **not a log**. A log is prose written for a human to read
 * later, open-ended by nature: whoever writes the line chooses what goes in it,
 * so the only way to know a log contains no secret is to read every line ever
 * written. A trace is a fixed record with named fields and a strict schema, so
 * "does this contain the user's prompt?" is answerable by looking at the type
 * rather than at the data.
 *
 * That difference is the whole reason this exists. Once an agent's reasoning is
 * a model call, "why did it pick that?" becomes the first question asked — and
 * the tempting answer is to store the prompt and the reply. This says no, and
 * makes the no structural:
 *
 *   what is recorded    who, when, how long, what was decided, which tools
 *                       were consulted, and whether it worked
 *
 *   what cannot be      the request, the prompt, the reasoning, the tool
 *                       inputs, the tool outputs, secrets — there is no field
 *                       for any of them, and every schema here is `.strict()`
 *
 * A trace answers "what happened?". It does not answer "what was it thinking?",
 * and the decision not to answer that is permanent rather than a default.
 */

// ── Identity and status ─────────────────────────────────────────

export const traceStatusSchema = z.enum(["running", "completed", "failed"]);

export type TraceStatus = z.infer<typeof traceStatusSchema>;

export const traceDecisionTypeSchema = z.enum([
  "run_workflow",
  "request_clarification",
  "decline",
]);

export type TraceDecisionType = z.infer<typeof traceDecisionTypeSchema>;

/**
 * One tool consultation, as it appears on a trace.
 *
 * Three facts: which tool, how long, and whether it worked. Not what it was
 * asked, and not what it said. `errorCode` is a stable `ERR_TOOL_*` code, which
 * is a classification rather than a message — a message could carry a path or a
 * value, a code cannot.
 */
export const traceToolCallSchema = z
  .object({
    toolId: z.string().min(1),
    durationMs: z.number().nonnegative(),
    status: z.enum(["success", "failure"]),
    errorCode: z.string().min(1).optional(),
  })
  .strict();

export type TraceToolCall = z.infer<typeof traceToolCallSchema>;

/**
 * One attempted model candidate, as it appears anywhere on a trace.
 *
 * Defined once and reused by the trace, the patch and both model events. It
 * was previously written out inline in each of those places, and they drifted:
 * the runtime started reporting a per-candidate `durationMs` that one strict
 * copy did not accept, so the whole failed-call record was rejected at
 * persistence and silently dropped — the exhausted chain in field run
 * 926a8b19 left no per-candidate record at all. One definition, no drift.
 */
export const traceModelCandidateAttemptSchema = z
  .object({
    model: z.string().min(1),
    code: z.string().min(1),
    durationMs: z.number().nonnegative().optional(),
    /** Bounded sanitized upstream explanation. Never a raw payload. */
    reason: z.string().min(1).max(300).optional(),
  })
  .strict();

export type TraceModelCandidateAttempt = z.infer<typeof traceModelCandidateAttemptSchema>;

/**
 * One model call, as it appears on a trace.
 *
 * The same discipline as `TraceToolCall`, one layer up: which provider and
 * model, how long, whether it worked, and safe usage counts when the provider
 * reported any. Never the messages sent, never the structured output that
 * came back — a model call is the highest-density place secrets and user
 * content pass through this system, and the schema's strictness is what makes
 * "does a trace ever hold a prompt?" answerable by reading the type rather
 * than auditing every call site that builds one.
 *
 * `model` — the exact slug, e.g. `anthropic/claude-3.5-sonnet` — is
 * considered safe trace metadata and is stored deliberately. It identifies
 * *which model decided*, the same category of fact `workflowId` already is;
 * it is provider/version information, not user content, and withholding it
 * would make a trace useless for the one thing Stage 38 exists to support:
 * telling two model configurations apart after the fact.
 */
export const traceModelCallSchema = z
  .object({
    requestId: z.string().min(1),
    profileId: z.string().min(1),
    /** Absent for a failure that never reached a resolved provider. */
    providerId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    durationMs: z.number().nonnegative(),
    status: z.enum(["success", "failure"]),
    errorCode: z.string().min(1).optional(),
    usage: modelUsageSchema.optional(),
    /** Ordered-model-policy provenance: 0 = primary, >0 = fallback position. */
    fallbackIndex: z.number().int().nonnegative().optional(),
    candidateCount: z.number().int().positive().optional(),
    /** Bounded sanitized earlier candidate failures (policy provenance). */
    previousFailures: z.array(traceModelCandidateAttemptSchema).max(8).optional(),
  })
  .strict();

export type TraceModelCall = z.infer<typeof traceModelCallSchema>;

/**
 * How much normalized design evidence an agent compiled into a model request.
 *
 * Counts and byte sizes only. It exists because "the model request was too
 * large / too small" was, in the field, only answerable by re-running the
 * capture: the trace recorded the failure code but nothing about the input
 * that produced it. Deliberately unable to hold evidence, prompts or output.
 */
export const traceEvidenceMetricsSchema = z
  .object({
    snapshotNodeCount: z.number().int().nonnegative(),
    snapshotBytes: z.number().int().nonnegative().optional(),
    bundleElementCount: z.number().int().nonnegative(),
    bundleComponentCount: z.number().int().nonnegative(),
    bundleInstanceCount: z.number().int().nonnegative(),
    bundleBytes: z.number().int().nonnegative(),
    /**
     * Canonical UI Blueprint sizing (Agent Architecture V2). Optional, so a
     * trace written by the legacy Specification path stays valid and a V2 run
     * can be told apart from it by the presence of these fields alone.
     */
    blueprintDraftBytes: z.number().int().nonnegative().optional(),
    blueprintElementCount: z.number().int().nonnegative().optional(),
    blueprintComponentCount: z.number().int().nonnegative().optional(),
    semanticPartitionCount: z.number().int().nonnegative().optional(),
    semanticPatchBytes: z.number().int().nonnegative().optional(),
    finalBlueprintBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export type TraceEvidenceMetrics = z.infer<typeof traceEvidenceMetricsSchema>;

/** Safe structural facts for a rejected Coordinator response. */
export const coordinatorOutputDiagnosticSchema = z
  .object({
    attempt: z.number().int().min(1).max(2),
    maxAttempts: z.number().int().min(1).max(2),
    errorCode: z.string().min(1).max(96),
    schemaPath: z.string().min(1).max(160).optional(),
    returnedAction: z.string().min(1).max(80).optional(),
    allowedActions: z.array(z.string().min(1).max(80)).max(16),
    finishReason: z.string().min(1).max(80).optional(),
    outputLength: z.number().int().min(0).max(100_000),
    truncated: z.boolean(),
  })
  .strict();

export type CoordinatorOutputDiagnostic = z.infer<
  typeof coordinatorOutputDiagnosticSchema
>;

// ── The trace ───────────────────────────────────────────────────

export const agentTraceSchema = z
  .object({
    /** Unique per decision. Correlates the worker, agent, tools and outcome. */
    id: z.string().min(1),
    /**
     * The workflow execution this decision started, once it has started one.
     *
     * The bridge between "an agent decided" and "a run happened", and the only
     * link between the two. Absent for a clarification or a decline, because
     * neither produces an execution to point at — which is precisely why the
     * engine's own history cannot answer questions about them.
     */
    executionId: z.string().min(1).optional(),
    workerId: z.string().min(1),
    agentId: z.string().min(1),
    /** ISO-8601. A string rather than an epoch, so a stored trace reads. */
    startedAt: z.string().min(1),
    completedAt: z.string().min(1).optional(),
    status: traceStatusSchema,
    decisionType: traceDecisionTypeSchema.optional(),
    workflowId: z.string().min(1).optional(),
    /** A stable code when the decision was refused. Never a message. */
    errorCode: z.string().min(1).optional(),
    durationMs: z.number().nonnegative().optional(),
    /**
     * The tools consulted, in call order.
     *
     * Beyond the shape this stage was asked for, and worth the addition: "one
     * tool call" is the single most useful fact about an agent's behaviour, and
     * burying it in `metadata` would make it untyped and unvalidated.
     */
    toolCalls: z.array(traceToolCallSchema).default([]),
    /**
     * The model calls consulted, in call order.
     *
     * Additive in this stage, the same way `toolCalls` was additive in
     * Stage 37: a trace written before models existed has none, and a
     * deterministic agent's trace still has none — the field is present and
     * empty rather than the schema growing a second, model-flavoured trace
     * shape.
     */
    modelCalls: z.array(traceModelCallSchema).default([]),
    coordinatorDiagnostics: z
      .array(coordinatorOutputDiagnosticSchema)
      .max(2)
      .default([]),
    /** Model-input size provenance, when the agent compiled design evidence. */
    evidence: traceEvidenceMetricsSchema.optional(),
    /**
     * Host-supplied facts about the installation, not about the request.
     *
     * The one open field, and the one place a careless caller could put
     * something it should not. Nothing in DesignFlow writes it; a test asserts
     * the traces this product produces leave it empty.
     */
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentTrace = z.infer<typeof agentTraceSchema>;

/** The fields a trace gains as a decision progresses. */
export const agentTracePatchSchema = z
  .object({
    executionId: z.string().min(1).optional(),
    completedAt: z.string().min(1).optional(),
    status: traceStatusSchema.optional(),
    decisionType: traceDecisionTypeSchema.optional(),
    workflowId: z.string().min(1).optional(),
    errorCode: z.string().min(1).optional(),
    durationMs: z.number().nonnegative().optional(),
    toolCalls: z.array(traceToolCallSchema).optional(),
    modelCalls: z.array(traceModelCallSchema).optional(),
    coordinatorDiagnostics: z
      .array(coordinatorOutputDiagnosticSchema)
      .max(2)
      .optional(),
    evidence: traceEvidenceMetricsSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentTracePatch = z.infer<typeof agentTracePatchSchema>;

// ── Trace events ────────────────────────────────────────────────

/**
 * What the runtime reports as a decision unfolds.
 *
 * Events are the transport; the trace is the record they build. Kept separate
 * because a consumer that only wants to watch — a live progress display, a
 * future evaluation harness — should not have to poll a store, and a store
 * should not have to be present for a decision to run.
 *
 * Every member is `.strict()` and carries only identifiers, codes, durations
 * and counts. As with the trace itself, the guarantee is that there is nowhere
 * to put a payload rather than that nobody put one there.
 */
export const traceEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("agent.invocation.started"),
      traceId: z.string().min(1),
      workerId: z.string().min(1),
      agentId: z.string().min(1),
      timestamp: z.string().min(1),
      executionId: z.string().min(1).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.invocation.completed"),
      traceId: z.string().min(1),
      durationMs: z.number().nonnegative(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.invocation.failed"),
      traceId: z.string().min(1),
      errorCode: z.string().min(1),
      durationMs: z.number().nonnegative(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.decision.started"),
      traceId: z.string().min(1),
      workerId: z.string().min(1),
      agentId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.call.observed"),
      traceId: z.string().min(1),
      toolId: z.string().min(1),
      durationMs: z.number().nonnegative(),
      status: z.enum(["success", "failure"]),
      errorCode: z.string().min(1).optional(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.request.started"),
      traceId: z.string().min(1),
      requestId: z.string().min(1),
      /**
       * Only the profile, not the provider or model.
       *
       * Both are genuinely unknown at this point: the profile is what the
       * caller asked for, and resolving it to an actual provider and model
       * slug is the model layer's job, not finished until the call returns.
       * `model.request.completed` and `model.request.failed` carry both once
       * they are known, rather than this event guessing or leaving a
       * placeholder.
       */
      profileId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.request.completed"),
      traceId: z.string().min(1),
      requestId: z.string().min(1),
      profileId: z.string().min(1),
      providerId: z.string().min(1),
      model: z.string().min(1),
      durationMs: z.number().nonnegative(),
      usage: modelUsageSchema.optional(),
      /** Ordered-model-policy provenance, when a candidate list was configured. */
      fallbackIndex: z.number().int().nonnegative().optional(),
      candidateCount: z.number().int().positive().optional(),
      previousFailures: z.array(traceModelCandidateAttemptSchema).max(8).optional(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("model.request.failed"),
      traceId: z.string().min(1),
      requestId: z.string().min(1),
      profileId: z.string().min(1),
      /**
       * Optional, unlike on `model.request.completed`.
       *
       * A failure that never reached a provider — an unresolved profile, an
       * unresolved provider id — has neither. `ModelResult`'s failure member
       * carries no such fields at all; there is nothing to fill this in from
       * for most failure codes, and a placeholder string would be a value
       * pretending to be data.
       */
      providerId: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      /** A stable `ERR_MODEL_*` code. Never the provider's own error text. */
      errorCode: z.string().min(1),
      durationMs: z.number().nonnegative(),
      /**
       * Ordered-model-policy provenance for a failed request: which candidate
       * models were attempted, in order, with their own codes and elapsed
       * time. Without it a candidates-exhausted failure recorded which codes
       * happened but not which candidate spent the time.
       */
      previousFailures: z.array(traceModelCandidateAttemptSchema).max(8).optional(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      /** Model-input size provenance, emitted before the request is issued. */
      type: z.literal("agent.evidence.compiled"),
      traceId: z.string().min(1),
      agentId: z.string().min(1),
      metrics: traceEvidenceMetricsSchema,
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.coordinator.output.invalid"),
      traceId: z.string().min(1),
      diagnostic: coordinatorOutputDiagnosticSchema,
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.decision.completed"),
      traceId: z.string().min(1),
      decisionType: traceDecisionTypeSchema,
      workflowId: z.string().min(1).optional(),
      durationMs: z.number().nonnegative(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.decision.failed"),
      traceId: z.string().min(1),
      /**
       * A stable code, never a message.
       *
       * The refusal that matters most here is `ERR_AGENT_DECISION_INVALID`,
       * raised when an agent attached private reasoning to its decision. The
       * code says that happened; recording the message would record the
       * reasoning that caused it, which would defeat the point entirely.
       */
      errorCode: z.string().min(1),
      durationMs: z.number().nonnegative(),
      timestamp: z.string().min(1),
    })
    .strict(),
]);

export type TraceEvent = z.infer<typeof traceEventSchema>;

// ── Ports ───────────────────────────────────────────────────────

/**
 * Somewhere for trace events to go.
 *
 * Asynchronous, because the durable implementation writes to disk. The emitting
 * side awaits it — a CLI process exits as soon as a decision resolves, and a
 * fire-and-forget write would simply be lost — but wraps every call so a
 * failure cannot reach the decision. Tracing that could break the thing it
 * traces would be worse than no tracing.
 */
export interface TraceObserver {
  onEvent(event: TraceEvent): Promise<void>;
}

/** The default. Tracing is opt-in. */
export const NOOP_TRACE_OBSERVER: TraceObserver = {
  onEvent: () => Promise.resolve(),
};

export const traceFiltersSchema = z
  .object({
    workerId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    status: traceStatusSchema.optional(),
    executionId: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type TraceFilters = z.infer<typeof traceFiltersSchema>;

/**
 * Where traces live.
 *
 * Declared here and implemented elsewhere, like every other store contract in
 * the SDK — an in-memory one for tests and embedding, a file-backed one for the
 * installed CLI.
 */
export interface TraceStore {
  create(trace: AgentTrace): Promise<void>;
  update(traceId: string, patch: AgentTracePatch): Promise<void>;
  get(traceId: string): Promise<AgentTrace | null>;
  list(filters?: TraceFilters): Promise<readonly AgentTrace[]>;
}

/**
 * Filtering and ordering, shared by every store implementation.
 *
 * Most recent first, because the question a person asks about traces is almost
 * always about the run they just did.
 */
export function selectTraces(
  traces: readonly AgentTrace[],
  filters?: TraceFilters,
): readonly AgentTrace[] {
  const validated = filters === undefined ? {} : traceFiltersSchema.parse(filters);

  const matched = traces.filter(
    (trace) =>
      (validated.workerId === undefined || trace.workerId === validated.workerId) &&
      (validated.agentId === undefined || trace.agentId === validated.agentId) &&
      (validated.status === undefined || trace.status === validated.status) &&
      (validated.executionId === undefined ||
        trace.executionId === validated.executionId),
  );

  const ordered = [...matched].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );

  return validated.limit === undefined ? ordered : ordered.slice(0, validated.limit);
}
