// packages/product/src/traces.ts
import {
  agentTracePatchSchema,
  agentTraceSchema,
  selectTraces,
  traceEventSchema,
  type AgentTrace,
  type AgentTracePatch,
  type TraceEvent,
  type TraceFilters,
  type TraceObserver,
  type TraceStore,
} from "@designflow/sdk";

/**
 * The product layer's tracing.
 *
 * Three pieces, deliberately separate:
 *
 *   `InMemoryTraceStore`  where traces live, for tests and embedding
 *   `TraceCollector`      turns the runtime's events into stored traces
 *   `TraceService`        the read API a surface is allowed to use
 *
 * The split matters at the last one. A CLI holding a `TraceStore` could write
 * traces, and a surface that can write its own audit record is not an audit
 * record. `TraceService` exposes reads plus two narrowly scoped writes —
 * correlating a trace with the execution it produced and attaching bounded
 * execution metadata — because those facts are only knowable by whoever
 * started the run.
 *
 * All of it sits outside the engine. `packages/core` does not know agents
 * exist, and after this stage it still does not know traces do.
 */

// ── Store ───────────────────────────────────────────────────────

export class InMemoryTraceStore implements TraceStore {
  private readonly traces = new Map<string, AgentTrace>();

  /**
   * `async` rather than returning a constructed promise.
   *
   * `parse` throws, and a synchronous throw from something typed `Promise<T>`
   * escapes before a caller can attach a handler — so a caller that carefully
   * wrapped this in `.catch()` would still crash. The same trap the tool
   * runtime hit in Stage 36.
   */
  public async create(trace: AgentTrace): Promise<void> {
    const validated = agentTraceSchema.parse(trace);
    this.traces.set(validated.id, validated);
  }

  /**
   * Applies a patch, ignoring a trace that is not there.
   *
   * Silent rather than throwing: an update arriving for an unknown trace means
   * the create was lost, and failing the second write cannot recover the first
   * — it would only turn a gap in the record into a broken decision.
   */
  public async update(traceId: string, patch: AgentTracePatch): Promise<void> {
    const existing = this.traces.get(traceId);
    if (existing === undefined) return;

    const validated = agentTracePatchSchema.parse(patch);
    this.traces.set(traceId, agentTraceSchema.parse({ ...existing, ...validated }));
  }

  public async get(traceId: string): Promise<AgentTrace | null> {
    return this.traces.get(traceId) ?? null;
  }

  public async list(filters?: TraceFilters): Promise<readonly AgentTrace[]> {
    return selectTraces([...this.traces.values()], filters);
  }
}

// ── Collector ───────────────────────────────────────────────────

/**
 * Builds traces from the events a decision emits.
 *
 * The only thing that writes a trace during a decision. It holds no state of
 * its own beyond the tool calls it is accumulating — the store is the record,
 * and a collector that cached traces would be a second one that could disagree.
 *
 * Every event is parsed before it is acted on. The runtime is trusted code, but
 * a trace is an audit record, and an audit record that accepts whatever it is
 * handed is not one.
 */
export class TraceCollector implements TraceObserver {
  private readonly store: TraceStore;
  /** Tool calls seen for a trace that has not closed yet. */
  private readonly pendingTools = new Map<string, AgentTrace["toolCalls"]>();
  /** Model calls seen for a trace that has not closed yet. */
  private readonly pendingModels = new Map<string, AgentTrace["modelCalls"]>();

  public constructor(store: TraceStore) {
    this.store = store;
  }

  public async onEvent(event: TraceEvent): Promise<void> {
    const validated = traceEventSchema.parse(event);

    switch (validated.type) {
      case "agent.invocation.started": {
        this.pendingTools.set(validated.traceId, []);
        this.pendingModels.set(validated.traceId, []);

        await this.store.create(
          agentTraceSchema.parse({
            id: validated.traceId,
            workerId: validated.workerId,
            agentId: validated.agentId,
            startedAt: validated.timestamp,
            ...(validated.executionId !== undefined
              ? { executionId: validated.executionId }
              : {}),
            status: "running",
            toolCalls: [],
            modelCalls: [],
            ...(validated.metadata !== undefined
              ? { metadata: validated.metadata }
              : {}),
          }),
        );
        return;
      }

      case "agent.decision.started": {
        this.pendingTools.set(validated.traceId, []);
        this.pendingModels.set(validated.traceId, []);

        await this.store.create(
          agentTraceSchema.parse({
            id: validated.traceId,
            workerId: validated.workerId,
            agentId: validated.agentId,
            startedAt: validated.timestamp,
            status: "running",
            toolCalls: [],
            modelCalls: [],
          }),
        );
        return;
      }

      case "tool.call.observed": {
        const calls = [
          ...(this.pendingTools.get(validated.traceId) ?? []),
          {
            toolId: validated.toolId,
            durationMs: validated.durationMs,
            status: validated.status,
            ...(validated.errorCode !== undefined
              ? { errorCode: validated.errorCode }
              : {}),
          },
        ];

        this.pendingTools.set(validated.traceId, calls);
        await this.store.update(validated.traceId, { toolCalls: calls });
        return;
      }

      // A `started` event exists for a live view to consume; the persisted
      // trace itself only ever needs the terminal outcome, so this collector
      // does not record it as a partial call — it would leave a
      // half-finished entry behind for any decision this trace's `completed`
      // or `failed` event races with `onEvent`'s own await, which never
      // actually happens since every call here is awaited in order.
      case "model.request.started": {
        return;
      }

      case "model.request.completed": {
        const calls = [
          ...(this.pendingModels.get(validated.traceId) ?? []),
          {
            requestId: validated.requestId,
            profileId: validated.profileId,
            providerId: validated.providerId,
            model: validated.model,
            durationMs: validated.durationMs,
            status: "success" as const,
            ...(validated.usage !== undefined ? { usage: validated.usage } : {}),
          },
        ];

        this.pendingModels.set(validated.traceId, calls);
        await this.store.update(validated.traceId, { modelCalls: calls });
        return;
      }

      case "model.request.failed": {
        const calls = [
          ...(this.pendingModels.get(validated.traceId) ?? []),
          {
            requestId: validated.requestId,
            profileId: validated.profileId,
            durationMs: validated.durationMs,
            status: "failure" as const,
            errorCode: validated.errorCode,
          },
        ];

        this.pendingModels.set(validated.traceId, calls);
        await this.store.update(validated.traceId, { modelCalls: calls });
        return;
      }

      case "agent.decision.completed": {
        await this.store.update(validated.traceId, {
          status: "completed",
          decisionType: validated.decisionType,
          ...(validated.workflowId !== undefined
            ? { workflowId: validated.workflowId }
            : {}),
          durationMs: validated.durationMs,
          completedAt: validated.timestamp,
        });
        this.pendingTools.delete(validated.traceId);
        this.pendingModels.delete(validated.traceId);
        return;
      }

      case "agent.invocation.completed": {
        await this.store.update(validated.traceId, {
          status: "completed",
          durationMs: validated.durationMs,
          completedAt: validated.timestamp,
        });
        this.pendingTools.delete(validated.traceId);
        this.pendingModels.delete(validated.traceId);
        return;
      }

      case "agent.decision.failed": {
        await this.store.update(validated.traceId, {
          status: "failed",
          errorCode: validated.errorCode,
          durationMs: validated.durationMs,
          completedAt: validated.timestamp,
        });
        this.pendingTools.delete(validated.traceId);
        this.pendingModels.delete(validated.traceId);
        return;
      }

      case "agent.invocation.failed": {
        await this.store.update(validated.traceId, {
          status: "failed",
          errorCode: validated.errorCode,
          durationMs: validated.durationMs,
          completedAt: validated.timestamp,
        });
        this.pendingTools.delete(validated.traceId);
        this.pendingModels.delete(validated.traceId);
        return;
      }
    }
  }
}

// ── Read API ────────────────────────────────────────────────────

/**
 * What a surface may ask about traces.
 *
 * Reads, plus the one write nobody else can perform. A CLI or an HTTP tier
 * talks to this and never to a `TraceStore`, for the same reason it talks to
 * `ProductExecutionService` and never to a repository: a consumer that can
 * write the record it displays can make the record say anything.
 */
export class TraceService {
  private readonly store: TraceStore;

  public constructor(store: TraceStore) {
    this.store = store;
  }

  public getTrace(traceId: string): Promise<AgentTrace | null> {
    return this.store.get(traceId);
  }

  public listTraces(filters?: TraceFilters): Promise<readonly AgentTrace[]> {
    return this.store.list(filters);
  }

  /**
   * The trace behind a run, if an agent started it.
   *
   * Returns null for a workflow started directly, which is the honest answer:
   * a run with no agent behind it has no decision to explain.
   */
  public async getExecutionTrace(executionId: string): Promise<AgentTrace | null> {
    const [found] = await this.store.list({ executionId, limit: 1 });
    return found ?? null;
  }

  /**
   * Records that a decision produced a run.
   *
   * The only write a surface may make, and only because it is the only party
   * that knows: the agent runtime decides and returns, and something else takes
   * that decision to `WorkflowRunner`. Without this the trace and the execution
   * could only be matched by timestamp, which is a guess.
   */
  public correlate(traceId: string, executionId: string): Promise<void> {
    return this.store.update(traceId, { executionId });
  }

  /** Adds bounded host facts learned after the decision starts. */
  public annotate(
    traceId: string,
    metadata: Readonly<{
      readonly sourceMode?: string;
      readonly mcpRetrieval?: "succeeded" | "not-completed";
      readonly cacheBypass?: boolean;
      readonly artifactsCreated?: number;
      readonly artifactsReused?: number;
    }>,
  ): Promise<void> {
    return this.store.update(traceId, { metadata: { ...metadata } });
  }
}
