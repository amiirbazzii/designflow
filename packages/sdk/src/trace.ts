// packages/sdk/src/trace.ts
import { z } from "zod";

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
