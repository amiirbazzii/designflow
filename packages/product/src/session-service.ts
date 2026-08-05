// packages/product/src/session-service.ts
import {
  agentSessionSchema,
  answerSessionRequestSchema,
  cancelSessionRequestSchema,
  hashContent,
  isSessionExpired,
  isTerminalSessionStatus,
  selectSessions,
  sessionEventSchema,
  sessionResultSchema,
  startSessionRequestSchema,
  withEffectiveSessionStatus,
  withReuseIdentity,
  DesignFlowError,
  NOOP_SESSION_OBSERVER,
  type AgentDecision,
  type AgentSession,
  type AgentSessionPatch,
  type AnswerSessionRequest,
  type CancelSessionRequest,
  type ReuseIdentity,
  type SessionEvent,
  type SessionListFilter,
  type SessionObserver,
  type SessionResult,
  type SessionStore,
  type StartSessionRequest,
  type WorkerManifest,
  type WorkerRegistry,
} from "@designflow/sdk";

import {
  buildInitialSessionContext,
  buildSessionContext,
  type SessionContext,
} from "./session-context";

import type { AgentKnowledgeContext, AgentKnowledgeService } from "./context-assembly";
import { WorkerTaskRouter, UnknownWorkerError } from "./worker-task";
import type { ExecutionHandle, ExecutionReport, WorkflowLaunchRequest } from "./schemas";
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
  explain?(executionId: string): Promise<ExecutionReport>;
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
  /**
   * The deciding agent's manifest version, snapshotted the same way
   * `resolveModelProfileId` is. Threaded into the workflow's reuse identity so
   * a node whose output could depend on an agent's own behaviour invalidates
   * when the agent's version changes, not only when its raw input does.
   */
  readonly resolveAgentVersion?: ((agentId: string) => string | undefined) | undefined;
  /**
   * Project Context and Agent Memory, assembled fresh for each decision.
   *
   * Optional and additive — a session service built without one behaves
   * exactly as Stage 39 left it. When present, it is consulted on the first
   * turn and re-consulted on every resumed turn (never cached on the
   * session), so a fact or a piece of memory that changes mid-conversation is
   * reflected on the very next decision.
   */
  readonly knowledge?: AgentKnowledgeService | undefined;
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
  private readonly resolveAgentVersion: ((agentId: string) => string | undefined) | undefined;
  private readonly knowledge: AgentKnowledgeService | undefined;

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

  /**
   * The same cache `answerSession` uses, applied to creation.
   *
   * There is no session id yet at creation time, so the key is the worker
   * being started plus the caller's key rather than a session id plus the
   * caller's key — otherwise this is exactly `idempotency` above: a duplicate
   * `startSession`/`startSessionForWorker` call with the same key against the
   * same worker returns the first attempt's session instead of starting a
   * second one. A separate map, not a shared namespace with `idempotency`,
   * because a worker id and a session id could otherwise collide on the same
   * string.
   */
  private readonly startIdempotency = new Map<string, Promise<SessionResult>>();

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
    this.resolveAgentVersion = options.resolveAgentVersion;
    this.knowledge = options.knowledge;
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

    if (validated.idempotencyKey === undefined) {
      return this.startSessionForWorkerOnce(worker, validated, signal);
    }

    const cacheKey = `${worker.id}:${validated.idempotencyKey}`;
    const cached = this.startIdempotency.get(cacheKey);
    if (cached !== undefined) return cached;

    const attempt = this.startSessionForWorkerOnce(worker, validated, signal);
    this.startIdempotency.set(cacheKey, attempt);
    // A failed attempt must not be replayed as if it had succeeded.
    attempt.catch(() => this.startIdempotency.delete(cacheKey));

    return attempt;
  }

  private async startSessionForWorkerOnce(
    worker: WorkerManifest,
    validated: StartSessionRequest,
    signal?: AbortSignal,
  ): Promise<SessionResult> {
    // A worker with no agent has no clarification loop to have — the router
    // resolves its one possible decision regardless of what is known here.
    // The worker's own id stands in for `agentId` in that case: there is no
    // separate decision-maker identity to name, and the field must be a
    // stable, non-empty string either way.
    const agentId = worker.agentId ?? worker.id;

    const knowledgeContext = await this.assembleKnowledge(
      buildInitialSessionContext(validated.request, validated.input),
      validated.projectId,
      agentId,
    );

    const routed = await this.router.routeWorker(
      worker,
      {
        workerId: worker.id,
        request: validated.request,
        ...(validated.input !== undefined ? { input: validated.input } : {}),
        ...(knowledgeContext !== undefined ? { context: knowledgeContextFields(knowledgeContext) } : {}),
      },
      signal,
    );

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
      ...(validated.projectId !== undefined ? { projectId: validated.projectId } : {}),
    });

    await this.persistCreate(session);

    await this.emit({
      type: "session.created",
      sessionId: session.id,
      workerId: session.workerId,
      agentId: session.agentId,
      timestamp: now,
    });

    return this.applyDecision(session, routed.decision, routed.traceId, knowledgeContext);
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

    // Re-resolved on every turn, using the project *snapshotted at creation*
    // — the session's own `projectId` never changes mid-conversation, but the
    // facts and memory it resolves to might, and a resumed decision should
    // see whatever is current, not whatever turn one saw.
    const knowledgeContext = await this.assembleKnowledge(context, answered.projectId, answered.agentId);

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
          ...(knowledgeContext !== undefined ? knowledgeContextFields(knowledgeContext) : {}),
        },
      },
      signal,
    );

    return this.applyDecision(answered, routed.decision, routed.traceId, knowledgeContext);
  }

  // ── Read ──────────────────────────────────────────────────────

  /**
   * `get`, with `status` normalized to what it actually is right now.
   *
   * A session whose `expiresAt` has passed since it was last written still
   * reports whatever status the store has for it — `waiting_for_user`, most
   * often — until something patches it. Reporting a stale status here would
   * make "did this conversation expire?" a question answerable only by also
   * checking `expiresAt` by hand, so this normalizes on every read instead;
   * `designflow cleanup` is what actually persists it.
   */
  public async getSession(sessionId: string): Promise<AgentSession> {
    const session = await this.requireSession(sessionId);
    return withEffectiveSessionStatus(session, this.clock.now());
  }

  /**
   * `list`, with the same status normalization `getSession` applies.
   *
   * A store's own `status` filter would miss a session that is stale but not
   * yet patched, so a `status` filter is applied here, after normalization,
   * rather than pushed down to the store — `workerId` still narrows what the
   * store itself fetches, since that part of a session never changes with
   * the clock.
   */
  public async listSessions(filters?: SessionListFilter): Promise<readonly AgentSession[]> {
    const raw = await this.store.list(
      filters?.workerId !== undefined ? { workerId: filters.workerId } : undefined,
    );

    const now = this.clock.now();
    const normalized = raw.map((session) => withEffectiveSessionStatus(session, now));

    return selectSessions(normalized, filters);
  }

  // ── Cleanup ───────────────────────────────────────────────────

  /**
   * Persists `expired` onto every stale `active`/`waiting_for_user` session.
   *
   * `getSession`/`listSessions` already *report* expiry without writing
   * anything; this is the one place it is actually recorded, so a store never
   * accumulates conversations that look resumable forever. Manual or
   * startup-triggered only — nothing here runs on a timer — and idempotent:
   * a session already patched to `expired` is terminal, so `isSessionExpired`
   * skips it on a second call.
   */
  public async cleanupExpiredSessions(): Promise<readonly AgentSession[]> {
    const now = this.clock.now();
    const all = await this.store.list();

    const stale = all.filter((session) => isSessionExpired(session, now));
    const expired: AgentSession[] = [];

    for (const session of stale) {
      try {
        const updated = await this.persistUpdate(session, { status: "expired", updatedAt: now });
        expired.push(updated);
        await this.emit({ type: "session.expired", sessionId: updated.id, timestamp: now });
      } catch (error) {
        // A version conflict means another writer already moved this
        // session on — nothing left here for cleanup to do to it. Any other
        // store failure is a real problem, and must not be swallowed the
        // same way.
        if (error instanceof DesignFlowError && error.code === "ERR_SESSION_CONFLICT") continue;
        throw error;
      }
    }

    return expired;
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
    knowledgeContext?: AgentKnowledgeContext,
  ): Promise<SessionResult> {
    const traceIds = traceId !== undefined ? [...session.traceIds, traceId] : session.traceIds;
    const now = this.clock.now();

    if (decision.type === "run_workflow") {
      const reuseIdentity = await this.buildReuseIdentity(session, knowledgeContext);

      const execution = await this.runner.start({
        workflowId: decision.workflowId,
        input: decision.input ?? session.originalInput,
        ...(reuseIdentity !== undefined
          ? { metadata: withReuseIdentity({}, reuseIdentity) }
          : {}),
      });

      if (traceId !== undefined && this.traces !== undefined) {
        try {
          await this.traces.correlate(traceId, execution.executionId);
          const original = session.originalInput as Record<string, unknown> | undefined;
          const sourceMode = original !== undefined && typeof original["figmaSourceMode"] === "string"
            ? original["figmaSourceMode"]
            : undefined;
          if (sourceMode !== undefined) {
            const report = this.runner.explain !== undefined
              ? await this.runner.explain(execution.executionId)
              : undefined;
            await this.traces.annotate(traceId, {
              sourceMode,
              ...(report !== undefined
                ? { mcpRetrieval: report.artifacts.some((artifact) => artifact.artifactId === "figma-source-snapshot")
                  ? "succeeded" as const
                  : "not-completed" as const }
                : {}),
              cacheBypass: original?.["refreshFigmaSource"] === true,
              ...(report !== undefined ? {
                artifactsCreated: report.overview.artifacts.created,
                artifactsReused: report.overview.artifacts.reused,
              } : {}),
            });
          }
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
    if (isSessionExpired(session, this.clock.now())) throw new SessionExpiredError(session.id);
    if (session.status === "cancelled") throw new SessionCancelledError(session.id);
    if (session.status !== "waiting_for_user") {
      throw new SessionNotWaitingError(session.id, session.status);
    }
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

  /**
   * Resolves Project Context and Agent Memory for one decision, or `undefined`
   * when no `AgentKnowledgeService` is configured — the fully backward-
   * compatible case every session before Stage 40 exercises.
   *
   * Never throws into the session flow: a knowledge assembly failure should
   * not be able to break a conversation whose whole point is resiliency, so a
   * decision simply proceeds with no project/memory context on failure — the
   * same "observing must never break the thing it observes" discipline this
   * class already applies to `emit`.
   */
  private async assembleKnowledge(
    sessionContext: SessionContext,
    projectId: string | undefined,
    agentId: string,
  ): Promise<AgentKnowledgeContext | undefined> {
    if (this.knowledge === undefined) return undefined;

    try {
      return await this.knowledge.getContext({
        sessionContext,
        ...(projectId !== undefined ? { projectId } : {}),
        agentId,
      });
    } catch {
      return undefined;
    }
  }

  private async emit(event: SessionEvent): Promise<void> {
    try {
      await this.observer.onEvent(sessionEventSchema.parse(event));
    } catch {
      // Observing must never break the session it observes.
    }
  }

  /**
   * The reuse identity a workflow started from this decision should carry.
   *
   * `undefined` when nothing about this decision is identity-bearing — no
   * project, no resolvable model profile or agent version — so a worker with
   * none of that (most of them, today) attaches no reuse identity at all and
   * a workflow's fingerprint depends only on its own input and dependencies,
   * exactly as before this existed.
   *
   * The project *content* fingerprint, not just its id, is what lets a change
   * to the project (framework, source root, ...) invalidate artifacts derived
   * from it — computed from the same facts and memory already assembled for
   * the agent's decision prompt, so this never re-reads the project itself.
   */
  private async buildReuseIdentity(
    session: AgentSession,
    knowledgeContext: AgentKnowledgeContext | undefined,
  ): Promise<ReuseIdentity | undefined> {
    const agentVersion = this.resolveAgentVersion?.(session.agentId);

    const projectContextFingerprint =
      knowledgeContext !== undefined
        ? await hashContent({
            facts: knowledgeContext.project?.facts ?? [],
            memory: knowledgeContext.memory,
          })
        : undefined;

    const identity: ReuseIdentity = {
      ...(session.projectId !== undefined ? { projectId: session.projectId } : {}),
      ...(projectContextFingerprint !== undefined ? { projectContextFingerprint } : {}),
      ...(session.modelProfileId !== undefined ? { modelProfileId: session.modelProfileId } : {}),
      ...(agentVersion !== undefined ? { agentVersion } : {}),
      ...figmaReuseIdentity(session.originalInput),
    };

    return Object.keys(identity).length > 0 ? identity : undefined;
  }
}

function figmaReuseIdentity(input: unknown): ReuseIdentity {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  const mode = record["figmaSourceMode"];
  if (mode !== "placeholder" && mode !== "rest" && mode !== "mcp-stdio" && mode !== "mcp-desktop") return {};

  const frames = Array.isArray(record["frames"])
    ? record["frames"].filter((value): value is string => typeof value === "string")
    : undefined;
  const serverIdentity = record["figmaServerIdentity"];
  return {
    figmaSourceMode: mode,
    ...(typeof serverIdentity === "string" ? { figmaServerIdentity: serverIdentity } : {}),
    ...(typeof record["designFile"] === "string" ? { figmaFileKey: extractFigmaFileKey(record["designFile"]) } : {}),
    ...(frames !== undefined ? { figmaFrames: frames } : {}),
    ...(typeof record["captureScreenshots"] === "boolean" ? { figmaCaptureScreenshots: record["captureScreenshots"] } : {}),
    ...(typeof record["figmaCacheBypass"] === "string" ? { figmaCacheBypass: record["figmaCacheBypass"] } : {}),
  };
}

function extractFigmaFileKey(value: string): string {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const kindIndex = segments.findIndex((segment) => segment === "design" || segment === "file");
    return kindIndex >= 0 && segments[kindIndex + 1] !== undefined
      ? segments[kindIndex + 1]!
      : value.slice(0, 160);
  } catch {
    return value.slice(0, 160);
  }
}

/**
 * The `project`/`memory` fields a `WorkerTaskRequest.context` carries when
 * knowledge was assembled — never the `session` field, which the request's
 * own `request`/`input`/`clarifications` already cover more precisely than a
 * round-trip through `AgentKnowledgeContext.session` would.
 */
function knowledgeContextFields(context: AgentKnowledgeContext): Record<string, unknown> {
  return {
    ...(context.project !== undefined ? { project: context.project } : {}),
    memory: context.memory,
  };
}

/** UTC, so a session created near midnight expires the same number of whole days later everywhere. */
function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
