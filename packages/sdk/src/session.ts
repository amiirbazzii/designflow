// packages/sdk/src/session.ts
import { z } from "zod";

/**
 * A session is bounded memory for one clarification conversation.
 *
 * An agent decides once per call — Stage 35 through 38 never changed that —
 * but `request_clarification` used to be a dead end: the CLI printed the
 * question and exited, and answering it meant starting over from nothing. A
 * session is what lets the same worker and the same agent pick a conversation
 * back up, without becoming the thing this design has repeatedly refused to
 * build: an unbounded chat transcript.
 *
 * It is not a log and it is not a chat history. It holds exactly what
 * resuming a decision needs — the original request, the clarification
 * questions asked and the answers given — and nothing a trace already covers
 * and nothing a provider call produced:
 *
 *   what is recorded    the original request, structured input, each
 *                       question/answer pair, status, turn count, which
 *                       traces and execution this conversation produced
 *
 *   what cannot be      chain-of-thought, prompts, raw completions, tool
 *                       inputs or outputs, credentials, stack traces — there
 *                       is no field for any of them, and every schema here is
 *                       `.strict()`
 *
 * A session answers "what has this conversation established so far?". It does
 * not answer "what was the agent thinking?" — that question belongs to a
 * trace, and a trace does not answer it either.
 */

// ── Status ──────────────────────────────────────────────────────

export const sessionStatusSchema = z.enum([
  "active",
  "waiting_for_user",
  "completed",
  "declined",
  "failed",
  "cancelled",
]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/**
 * The state machine, as data rather than as scattered `if` statements.
 *
 * A map from a status to the statuses it may become. Every terminal status —
 * `completed`, `declined`, `failed`, `cancelled` — maps to an empty list: a
 * session that finished stays finished, which is what makes "did this
 * conversation already start a workflow?" a question answerable by reading
 * one field rather than by reconstructing history.
 */
const SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  active: ["waiting_for_user", "completed", "declined", "failed", "cancelled"],
  waiting_for_user: ["active", "cancelled", "failed"],
  completed: [],
  declined: [],
  failed: [],
  cancelled: [],
};

/** Pure. The service consults this rather than inferring a transition from field presence. */
export function isValidSessionTransition(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

/** True once a session can no longer move — used to refuse resuming it. */
export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return SESSION_TRANSITIONS[status].length === 0;
}

// ── Answers ─────────────────────────────────────────────────────

/**
 * One clarification exchange.
 *
 * Not a chat message: no `role`, no free-form conversational shape. A
 * question the agent asked and the answer a person gave, bounded in length so
 * a session cannot become the unrestricted transcript this stage explicitly
 * does not build.
 */
export const sessionAnswerSchema = z
  .object({
    turn: z.number().int().positive(),
    question: z.string().min(1).max(2_000),
    answer: z.string().min(1).max(4_000),
    answeredAt: z.string().min(1),
  })
  .strict();

export type SessionAnswer = z.infer<typeof sessionAnswerSchema>;

// ── Session ─────────────────────────────────────────────────────

export const sessionDecisionTypeSchema = z.enum([
  "run_workflow",
  "request_clarification",
  "decline",
]);

export type SessionDecisionType = z.infer<typeof sessionDecisionTypeSchema>;

export const agentSessionSchema = z
  .object({
    id: z.string().min(1),
    workerId: z.string().min(1),
    agentId: z.string().min(1),
    status: sessionStatusSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    /** Optimistic-concurrency counter. Bumped on every stored update. */
    version: z.number().int().positive(),
    /** Clarification turns spent, enforced against the configured limit. */
    turnCount: z.number().int().nonnegative(),
    /** What the person originally asked for. Immutable once the session exists. */
    originalRequest: z.string(),
    /** The structured answers collected alongside the original request, if any. */
    originalInput: z.unknown().optional(),
    /** Set while `status` is `waiting_for_user`; cleared once answered. */
    currentQuestion: z.string().min(1).max(2_000).optional(),
    /** Set only when `status` is `declined`. The same reason a decision already carries. */
    declineReason: z.string().min(1).optional(),
    answers: z
      .array(sessionAnswerSchema)
      .default([])
      .superRefine((answers, ctx) => {
        for (let index = 1; index < answers.length; index += 1) {
          const current = answers[index];
          const previous = answers[index - 1];
          if (current !== undefined && previous !== undefined && current.turn <= previous.turn) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "answer turn numbers must strictly increase",
              path: [index, "turn"],
            });
          }
        }
      }),
    /** The most recent decision type reached, once one has been reached. */
    decisionType: sessionDecisionTypeSchema.optional(),
    /**
     * The trace recorded for each decision this session has made, in order.
     *
     * One entry per `AgentRuntime.decide` call the session invoked — the
     * session and its traces are two different records of the same
     * conversation, correlated by id, never merged into one.
     */
    traceIds: z.array(z.string().min(1)).default([]),
    /** The workflow execution this session produced, once `run_workflow` started one. */
    executionId: z.string().min(1).optional(),
    /**
     * The model profile identity in effect when this session started.
     *
     * A reference, the same as `AgentManifest.modelProfileId` — never a
     * provider id, a model slug or a credential. Snapshotted so a session
     * resumes against the same profile *identity* even if the profile's
     * configuration is edited mid-conversation; see the Stage 39 ADR for the
     * reproducibility policy this exists to support.
     */
    modelProfileId: z.string().min(1).optional(),
    expiresAt: z.string().min(1).optional(),
    /**
     * The project this conversation is scoped to, if any.
     *
     * Snapshotted once at creation, the same reproducibility reasoning
     * `modelProfileId` already documents — a conversation resumes against the
     * same project it started with, never a project chosen mid-conversation.
     * Project *context* and *memory* are still re-resolved fresh on every
     * turn; only which project is fixed.
     */
    projectId: z.string().min(1).optional(),
    /** Host-supplied facts. Nothing in DesignFlow writes it; see `AgentTrace.metadata`. */
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentSession = z.infer<typeof agentSessionSchema>;

/** The fields a stored session may gain as a conversation progresses. */
export const agentSessionPatchSchema = z
  .object({
    status: sessionStatusSchema.optional(),
    updatedAt: z.string().min(1),
    turnCount: z.number().int().nonnegative().optional(),
    currentQuestion: z.string().min(1).max(2_000).optional().nullable(),
    declineReason: z.string().min(1).optional(),
    answers: z.array(sessionAnswerSchema).optional(),
    decisionType: sessionDecisionTypeSchema.optional(),
    traceIds: z.array(z.string().min(1)).optional(),
    executionId: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentSessionPatch = z.infer<typeof agentSessionPatchSchema>;

/**
 * Merges a patch onto a stored session, the way every store implementation
 * must — shared here so `FileSessionStore` and `InMemorySessionStore` cannot
 * disagree about it.
 *
 * A patch field set to `null` (only `currentQuestion` can be, today) clears
 * that field rather than storing a literal `null` — `agentSessionSchema` has
 * no `null` member for it, on purpose, so a cleared question reads as
 * "absent" the same way it does on a session that was never asked one.
 */
export function applySessionPatch(
  existing: AgentSession,
  patch: AgentSessionPatch,
  nextVersion: number,
): AgentSession {
  const merged: Record<string, unknown> = { ...existing, version: nextVersion };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  return agentSessionSchema.parse(merged);
}

// ── Product-facing requests ─────────────────────────────────────

export const startSessionRequestSchema = z
  .object({
    workerId: z.string().min(1),
    request: z.string().default(""),
    input: z.unknown().optional(),
    /** The project this conversation should be scoped to, if any. See `AgentSession.projectId`. */
    projectId: z.string().min(1).optional(),
  })
  .strict();

export type StartSessionRequest = z.infer<typeof startSessionRequestSchema>;

export const answerSessionRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    answer: z.string().min(1).max(4_000),
    /**
     * Lets a caller that retries a submission — a flaky terminal, a repeated
     * HTTP POST — get back the result of the first attempt instead of
     * advancing the session a second time.
     */
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();

export type AnswerSessionRequest = z.infer<typeof answerSessionRequestSchema>;

export const cancelSessionRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    reason: z.string().min(1).optional(),
  })
  .strict();

export type CancelSessionRequest = z.infer<typeof cancelSessionRequestSchema>;

export const sessionListFilterSchema = z
  .object({
    status: sessionStatusSchema.optional(),
    workerId: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type SessionListFilter = z.infer<typeof sessionListFilterSchema>;

/** What a product surface gets back from starting or resuming a session. */
export const sessionResultSchema = z
  .object({
    session: agentSessionSchema,
    /** The clarification question or decline reason, when one applies. Never a workflow id. */
    message: z.string().min(1).optional(),
  })
  .strict();

export type SessionResult = z.infer<typeof sessionResultSchema>;

// ── Session events ──────────────────────────────────────────────

/**
 * What the Session Orchestrator reports as a conversation unfolds.
 *
 * The session-level analogue of `TraceEvent`: identifiers, statuses, turn
 * numbers and timestamps, and nothing a person typed. `sessionId` correlates
 * an event with the session's own stored answers, but the event itself never
 * carries the question or the answer text — a trace does not record what an
 * agent was asked, and a session event does not record what a person said in
 * response, for the same reason.
 */
export const sessionEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("session.created"),
      sessionId: z.string().min(1),
      workerId: z.string().min(1),
      agentId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.waiting_for_user"),
      sessionId: z.string().min(1),
      turn: z.number().int().positive(),
      traceId: z.string().min(1).optional(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.answered"),
      sessionId: z.string().min(1),
      turn: z.number().int().positive(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.resumed"),
      sessionId: z.string().min(1),
      turn: z.number().int().positive(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.completed"),
      sessionId: z.string().min(1),
      traceId: z.string().min(1).optional(),
      executionId: z.string().min(1).optional(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.declined"),
      sessionId: z.string().min(1),
      traceId: z.string().min(1).optional(),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.failed"),
      sessionId: z.string().min(1),
      errorCode: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.cancelled"),
      sessionId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.expired"),
      sessionId: z.string().min(1),
      timestamp: z.string().min(1),
    })
    .strict(),
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;

/**
 * Somewhere for session events to go. Optional and wrapped by every emitter —
 * a session's own state never depends on this succeeding, the same guarantee
 * `TraceObserver` gives the runtime.
 */
export interface SessionObserver {
  onEvent(event: SessionEvent): Promise<void>;
}

export const NOOP_SESSION_OBSERVER: SessionObserver = {
  onEvent: () => Promise.resolve(),
};

// ── Store port ──────────────────────────────────────────────────

/**
 * Where sessions live.
 *
 * Declared here and implemented elsewhere, the same shape as `TraceStore`:
 * an in-memory one for tests and embedding, a file-backed one for the
 * installed CLI. `update` takes the version the caller last saw and reports a
 * conflict rather than merging, so two racing writers cannot silently produce
 * a last-write-wins session — the concurrency guarantee has to live at the
 * store, because it is the only place that can see both writers.
 */
export interface SessionStore {
  create(session: AgentSession): Promise<void>;
  get(sessionId: string): Promise<AgentSession | null>;
  update(
    sessionId: string,
    expectedVersion: number,
    patch: AgentSessionPatch,
  ): Promise<AgentSession>;
  list(filters?: SessionListFilter): Promise<readonly AgentSession[]>;
}

/**
 * Filtering and ordering, shared by every store implementation.
 *
 * Most recently updated first — a session someone is waiting on is the one
 * they asked to see.
 */
export function selectSessions(
  sessions: readonly AgentSession[],
  filters?: SessionListFilter,
): readonly AgentSession[] {
  const validated = filters === undefined ? {} : sessionListFilterSchema.parse(filters);

  const matched = sessions.filter(
    (session) =>
      (validated.status === undefined || session.status === validated.status) &&
      (validated.workerId === undefined || session.workerId === validated.workerId),
  );

  const ordered = [...matched].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  return validated.limit === undefined ? ordered : ordered.slice(0, validated.limit);
}
