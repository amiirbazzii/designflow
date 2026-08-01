// packages/product/src/session-service.ts
import {
  agentSessionSchema,
  answerSessionRequestSchema,
  cancelSessionRequestSchema,
  isTerminalSessionStatus,
  sessionEventSchema,
  sessionResultSchema,
  startSessionRequestSchema,
  DesignFlowError,
  NOOP_SESSION_OBSERVER,
} from "@designflow/sdk";
import type {
  AgentDecision,
  AgentSession,
  AgentSessionPatch,
  AnswerSessionRequest,
  CancelSessionRequest,
  SessionEvent,
  SessionListFilter,
  SessionObserver,
  SessionResult,
  SessionStore,
  StartSessionRequest,
  WorkerManifest,
  WorkerRegistry,
} from "@designflow/sdk";
import { buildSessionContext } from "./session-context";
import { WorkerTaskRouter, UnknownWorkerError } from "./worker-task";
import type { ExecutionHandle, WorkflowLaunchRequest } from "./schemas";
import { TraceService } from "./traces";
import {
  SessionAnswerInvalidError,
  SessionCancelledError,
  SessionExpiredError,
  SessionNotFoundError,
  SessionNotWaitingError,
  SessionStateInvalidError,
  SessionStoreFailedError,
  SessionTurnLimitExceededError,
} from "./session-errors";

/**
 * The Session Orchestrator.
 *
 * `AgentRuntime.decide` still answers one question and returns — Stage 39
 * changes nothing about that. What did not exist before is somewhere for the
 * *conversation* around a `request_clarification` to live: this class owns
 * the repetition, not `AgentRuntime`, and not the CLI. Each call this makes
 * to `WorkerTaskRouter` is one bounded decision with its own tool and model
 * budget; this class only remembers what was asked and what was answered
 * between one call and the next.
 *
 * It depends on ports — `SessionStore`, `WorkerRegistry`, the product's own
 * `WorkerTaskRouter`/`WorkflowRunner`/`TraceService` — never on a concrete
 * file store or a concrete agent runtime. It knows nothing about workflow
 * execution beyond "start one and remember the id it returns"; the engine
 * itself remains unaware sessions exist at all.
 */

// ── Clock ───────────────────────────────────────────────────────

/** Injected so expiration and timestamps are testable without waiting on a wall clock. */
export interface SessionClock {
  now(): string;
}

export const SYSTEM_CLOCK: SessionClock = {
  now: () => new Date().toISOString(),
};

// ── Workflow starter port ──────────────────────────────────────

/**
 * The one `WorkflowRunner` verb a session needs.
 *
 * A port rather than the concrete class, the same reasoning
 * `WorkerTaskRouter` applies to `AgentDecisionService`: a session starts a
 * workflow and remembers the execution id it gets back, and nothing here
 * needs `WorkflowRunner`'s approval, history or progress surface to do that.
 * `WorkflowRunner` satisfies this structurally, with no adapter required.
 */
export interface SessionWorkflowStarter {
  start(request: WorkflowLaunchRequest): Promise<ExecutionHandle>;
}

// ── Options ─────────────────────────────────────────────────────

export interface AgentSessionServiceOptions {
  readonly store: SessionStore;
  readonly workers: WorkerRegistry;
  readonly router: WorkerTaskRouter;
  readonly runner: SessionWorkflowStarter;
  readonly traces?: TraceService | undefined;
  readonly observer?: SessionObserver | undefined;
  readonly clock?: SessionClock | undefined;
  /** Test-only. Defaults to `crypto.randomUUID`. */
  readonly generateId?: (() => string) | undefined;
  /** Externally enforced. An agent's own decisions cannot raise it. */
  readonly maxClarificationTurns?: number | undefined;
  readonly expirationDays?: number | undefined;
  /**
   * Safe model-profile identity, snapshotted onto the session at creation.
   *
   * Never resolves a live provider or credential — only the profile id an
   * agent's manifest names, the same reference `AgentManifest.modelProfileId`
   * already is. See the Stage 39 ADR for why the snapshot is preserved for
   * the session's lifetime rather than re-resolved on every resume.
   */
  readonly resolveModelProfileId?: ((agentId: string) => string | undefined) | undefined;
}

const DEFAULT_MAX_CLARIFICATION_TURNS = 5;
const DEFAULT_EXPIRATION_DAYS = 7;

export class AgentSessionService {
  private readonly store: SessionStore;
  private readonly workers: WorkerRegistry;
  private readonly router: WorkerTaskRouter;
  private readonly runner: SessionWorkflowStarter;
  private readonly traces: TraceService | undefined;
  private readonly observer: SessionObserver;
  private readonly clock: SessionClock;
  private readonly generateId: () => string;
  private readonly maxClarificationTurns: number;
  private readonly expirationDays: number;
  private readonly resolveModelProfileId: ((agentId: string) => string | undefined) | undefined;

  /**
   * Per-process idempotency cache, keyed by session id and the caller's key.
   *
   * A duplicate submission of the same answer with the same key returns the
   * first attempt's result rather than advancing the session twice. Scoped to
   * this process's lifetime — a CLI invocation is a fresh process either way,
   * so cross-process replay protection rests on the store's own optimistic
   * concurrency, not on this cache.
   */
  private readonly idempotency = new Map<string, Promise<SessionResult>>();

  public constructor(options: AgentSessionServiceOptions) {
    this.store = options.store;
    this.workers = options.workers;
    this.router = options.router;
    this.runner = options.runner;
    this.traces = options.traces;
    this.observer = options.observer ?? NOOP_SESSION_OBSERVER;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.maxClarificationTurns = options.maxClarificationTurns ?? DEFAULT_MAX_CLARIFICATION_TURNS;
    this.expirationDays = options.expirationDays ?? DEFAULT_EXPIRATION_DAYS;
    this.resolveModelProfileId = options.resolveModelProfileId;
  }

  // ── Start ─────────────────────────────────────────────────────

  public async startSession(
    request: StartSessionRequest,
    signal?: AbortSignal,
  ): Promise<SessionResult> {
    const validated = startSessionRequestSchema.parse(request);
    const worker = this.workers.getWorker(validated.workerId);

    if (worker === undefined) throw new UnknownWorkerError(validated.workerId);

    return this.startSessionForWorker(worker, validated, signal);
  }

  /**
   * Starts a session for a worker the caller already holds.
   *
   * For a surface that resolves a name itself before routing it — the CLI
   * accepts a workflow id as well as a worker id, and synthesises a manifest
   * for a workflow no worker owns — the same reason `WorkerTaskRouter`
   * exposes `routeWorker` alongside `route`.
   */
  public async startSessionForWorker(
    worker: WorkerManifest,
    request: StartSessionRequest,
    signal?: AbortSignal,
  ): Promise<SessionResult> {
    const validated = startSessionRequestSchema.parse(request);

    const routed = await this.router.routeWorker(
      worker,
      {
        workerId: worker.id,
        request: validated.request,
        ...(validated.input !== undefined ? { input: validated.input } : {}),
      },
      signal,
    );

    // A worker with no agent has no clarification loop to have — the router
    // already resolved its one possible decision. The worker's own id stands
    // in for `agentId`: there is no separate decision-maker identity to name,
    // and the field must be a stable, non-empty string either way.
    const agentId = routed.worker.agentId ?? routed.worker.id;
    const now = this.clock.now();
    const modelProfileId = this.resolveModelProfileId?.(agentId);

    const session = agentSessionSchema.parse({
      id: this.generateId(),
      workerId: routed.worker.id,
      agentId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 1,
      turnCount: 0,
      originalRequest: validated.request,
      ...(validated.input !== undefined ? { originalInput: validated.input } : {}),
      answers: [],
      traceIds: [],
      expiresAt: addDays(now, this.expirationDays),
      ...(modelProfileId !== undefined ? { modelProfileId } : {}),
    });

    await this.persistCreate(session);

    await this.emit({
      type: "session.created",
      sessionId: session.id,
      workerId: session.workerId,
      agentId: session.agentId,
      timestamp: now,
    });

    return this.applyDecision(session, routed.decision, routed.traceId);
  }

  // ── Resume ────────────────────────────────────────────────────

  public async answerSession(
    request: AnswerSessionRequest,
    signal?: AbortSignal,
  ): Promise<SessionResult> {
    const validated = answerSessionRequestSchema.parse(request);

    if (validated.idempotencyKey === undefined) {
      return this.answerSessionOnce(validated, signal);
    }

    const cacheKey = `${validated.sessionId}:${validated.idempotencyKey}`;
    const cached = this.idempotency.get(cacheKey);
    if (cached !== undefined) return cached;

    const attempt = this.answerSessionOnce(validated, signal);
    this.idempotency.set(cacheKey, attempt);
    // A failed attempt must not be replayed as if it had succeeded.
    attempt.catch(() => this.idempotency.delete(cacheKey));

    return attempt;
  }

  private async answerSessionOnce(
    validated: AnswerSessionRequest,
    signal?: AbortSignal,
  ): Promise<SessionResult> {
    const session = await this.requireSession(validated.sessionId);
    this.assertAnswerable(session);

    const turn = session.turnCount;
    const now = this.clock.now();

    let answered: AgentSession;
    try {
      answered = await this.persistUpdate(session, {
        status: "active",
        updatedAt: now,
        currentQuestion: null,
        answers: [
          ...session.answers,
          {
            turn,
            question: session.currentQuestion ?? "",
            answer: validated.answer,
            answeredAt: now,
          },
        ],
      });
    } catch (error) {
      if (error instanceof DesignFlowError) throw error;
      throw new SessionAnswerInvalidError(validated.sessionId, String(error));
    }

    await this.emit({ type: "session.answered", sessionId: answered.id, turn, timestamp: now });

    const worker = this.workers.getWorker(answered.workerId);
    if (worker === undefined) {
      throw new SessionStateInvalidError(answered.id, answered.status, "active");
    }

    const context = buildSessionContext(answered);

    await this.emit({
      type: "session.resumed",
      sessionId: answered.id,
      turn: turn + 1,
      timestamp: now,
    });

    const routed = await this.router.routeWorker(
      worker,
      {
        workerId: worker.id,
        request: answered.originalRequest,
        ...(answered.originalInput !== undefined ? { input: answered.originalInput } : {}),
        context: {
          clarifications: context.clarifications,
          ...(context.inputSummary !== undefined ? { inputSummary: context.inputSummary } : {}),
        },
      },
      signal,
    );

    return this.applyDecision(answered, routed.decision, routed.traceId);
  }

  // ── Read ──────────────────────────────────────────────────────

  public async getSession(sessionId: string): Promise<AgentSession> {
    return this.requireSession(sessionId);
  }

  public async listSessions(filters?: SessionListFilter): Promise<readonly AgentSession[]> {
    return this.store.list(filters);
  }

  // ── Cancel ────────────────────────────────────────────────────

  public async cancelSession(request: CancelSessionRequest): Promise<AgentSession> {
    const validated = cancelSessionRequestSchema.parse(request);
    const session = await this.requireSession(validated.sessionId);

    if (isTerminalSessionStatus(session.status)) {
      throw new SessionStateInvalidError(session.id, session.status, "cancelled");
    }

    const now = this.clock.now();
    const updated = await this.persistUpdate(session, {
      status: "cancelled",
      updatedAt: now,
      ...(validated.reason !== undefined
        ? { metadata: { ...(session.metadata ?? {}), cancelReason: validated.reason } }
        : {}),
    });

    await this.emit({ type: "session.cancelled", sessionId: updated.id, timestamp: now });

    return updated;
  }

  // ── Decision handling ────────────────────────────────────────

  /**
   * Turns one `AgentDecision` into a stored session transition.
   *
   * The one place `run_workflow`, `request_clarification` and `decline` are
   * handled — used identically by a session's first turn and every resumed
   * turn after it, so a decision cannot be handled differently depending on
   * which call produced it.
   */
  private async applyDecision(
    session: AgentSession,
    decision: AgentDecision,
    traceId: string | undefined,
  ): Promise<SessionResult> {
    const traceIds = traceId !== undefined ? [...session.traceIds, traceId] : session.traceIds;
    const now = this.clock.now();

    if (decision.type === "run_workflow") {
      const execution = await this.runner.start({
        workflowId: decision.workflowId,
        input: decision.input ?? session.originalInput,
      });

      if (traceId !== undefined && this.traces !== undefined) {
        try {
          await this.traces.correlate(traceId, execution.executionId);
        } catch {
          // Tracing must never break the run it traces — `run.ts` applies the
          // same discipline for the non-session path.
        }
      }

      const updated = await this.persistUpdate(session, {
        status: "completed",
        updatedAt: now,
        decisionType: "run_workflow",
        executionId: execution.executionId,
        traceIds,
      });

      await this.emit({
        type: "session.completed",
        sessionId: updated.id,
        ...(traceId !== undefined ? { traceId } : {}),
        executionId: execution.executionId,
        timestamp: now,
      });

      return sessionResultSchema.parse({ session: updated });
    }

    if (decision.type === "request_clarification") {
      const nextTurn = session.turnCount + 1;

      if (nextTurn > this.maxClarificationTurns) {
        const closed = await this.persistUpdate(session, {
          status: "failed",
          updatedAt: now,
          traceIds,
          metadata: {
            ...(session.metadata ?? {}),
            errorCode: "ERR_SESSION_TURN_LIMIT_EXCEEDED",
          },
        });

        await this.emit({
          type: "session.failed",
          sessionId: closed.id,
          errorCode: "ERR_SESSION_TURN_LIMIT_EXCEEDED",
          timestamp: now,
        });

        throw new SessionTurnLimitExceededError(closed.id, this.maxClarificationTurns);
      }

      const updated = await this.persistUpdate(session, {
        status: "waiting_for_user",
        updatedAt: now,
        turnCount: nextTurn,
        currentQuestion: decision.question,
        decisionType: "request_clarification",
        traceIds,
      });

      await this.emit({
        type: "session.waiting_for_user",
        sessionId: updated.id,
        turn: nextTurn,
        ...(traceId !== undefined ? { traceId } : {}),
        timestamp: now,
      });

      return sessionResultSchema.parse({ session: updated, message: decision.question });
    }

    // decline
    const updated = await this.persistUpdate(session, {
      status: "declined",
      updatedAt: now,
      decisionType: "decline",
      declineReason: decision.reason,
      traceIds,
    });

    await this.emit({
      type: "session.declined",
      sessionId: updated.id,
      ...(traceId !== undefined ? { traceId } : {}),
      timestamp: now,
    });

    return sessionResultSchema.parse({ session: updated, message: decision.reason });
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async requireSession(sessionId: string): Promise<AgentSession> {
    const session = await this.getStored(sessionId);
    if (session === null) throw new SessionNotFoundError(sessionId);
    return session;
  }

  private async getStored(sessionId: string): Promise<AgentSession | null> {
    try {
      return await this.store.get(sessionId);
    } catch (error) {
      throw this.normalizeStoreError(error);
    }
  }

  /** Checked before an answer is accepted, most specific reason first. */
  private assertAnswerable(session: AgentSession): void {
    if (this.isExpired(session)) throw new SessionExpiredError(session.id);
    if (session.status === "cancelled") throw new SessionCancelledError(session.id);
    if (session.status !== "waiting_for_user") {
      throw new SessionNotWaitingError(session.id, session.status);
    }
  }

  private isExpired(session: AgentSession): boolean {
    return session.expiresAt !== undefined && session.expiresAt <= this.clock.now();
  }

  private async persistCreate(session: AgentSession): Promise<void> {
    try {
      await this.store.create(session);
    } catch (error) {
      throw this.normalizeStoreError(error);
    }
  }

  private async persistUpdate(
    session: AgentSession,
    patch: AgentSessionPatch,
  ): Promise<AgentSession> {
    try {
      return await this.store.update(session.id, session.version, patch);
    } catch (error) {
      throw this.normalizeStoreError(error);
    }
  }

  private normalizeStoreError(error: unknown): Error {
    // A `DesignFlowError` from the store already carries a stable session
    // code — `ERR_SESSION_NOT_FOUND`, `ERR_SESSION_CONFLICT`,
    // `ERR_SESSION_ALREADY_EXISTS` — and is passed through as-is. Only a
    // genuinely unrecognised failure is wrapped, so a caller matching on
    // `error.code` never has to guess which layer raised it.
    if (error instanceof DesignFlowError) return error;
    return new SessionStoreFailedError(error);
  }

  private async emit(event: SessionEvent): Promise<void> {
    try {
      await this.observer.onEvent(sessionEventSchema.parse(event));
    } catch {
      // Observing must never break the session it observes.
    }
  }
}

/** UTC, so a session created near midnight expires the same number of whole days later everywhere. */
function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
