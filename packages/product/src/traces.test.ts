// packages/product/src/traces.test.ts
import { describe, expect, test } from "bun:test";
import type { AgentTrace, TraceEvent, TraceStore } from "@designflow/sdk";
import { InMemoryTraceStore, TraceCollector, TraceService } from "./traces";

/**
 * The product tracing layer.
 *
 * The collector turns events into a record; the service is what a surface may
 * read. The tests that matter most are the ones establishing that a full,
 * realistic decision leaves behind nothing a person said and nothing a tool
 * returned.
 */

const STARTED: TraceEvent = {
  type: "agent.decision.started",
  traceId: "trace-1",
  workerId: "design-engineer",
  agentId: "design-engineer-agent",
  timestamp: "2026-08-01T10:00:00.000Z",
};

function collector(): { store: InMemoryTraceStore; observer: TraceCollector } {
  const store = new InMemoryTraceStore();
  return { store, observer: new TraceCollector(store) };
}

// ── 5/6/7/8. The trace lifecycle ────────────────────────────────

describe("building a trace from events", () => {
  test("specialized invocations have their own trace lifecycle and safe metadata", async () => {
    const { store, observer } = collector();

    await observer.onEvent({
      type: "agent.invocation.started",
      traceId: "specialized-1",
      workerId: "capability-invocation",
      agentId: "figma-specification-agent",
      timestamp: "2026-08-01T10:00:00.000Z",
      metadata: { executionId: "exec-1", capabilityId: "invoke-figma-specification-agent" },
    });
    await observer.onEvent({
      type: "model.request.started",
      traceId: "specialized-1",
      requestId: "request-1",
      profileId: "figma-specification-default",
      timestamp: "2026-08-01T10:00:00.001Z",
    });
    await observer.onEvent({
      type: "model.request.failed",
      traceId: "specialized-1",
      requestId: "request-1",
      profileId: "figma-specification-default",
      errorCode: "ERR_MODEL_TIMEOUT",
      durationMs: 4,
      timestamp: "2026-08-01T10:00:00.005Z",
    });
    await observer.onEvent({
      type: "agent.invocation.failed",
      traceId: "specialized-1",
      errorCode: "ERR_MODEL_TIMEOUT",
      durationMs: 5,
      timestamp: "2026-08-01T10:00:00.006Z",
    });

    expect(await store.get("specialized-1")).toMatchObject({
      workerId: "capability-invocation",
      agentId: "figma-specification-agent",
      status: "failed",
      errorCode: "ERR_MODEL_TIMEOUT",
      metadata: { executionId: "exec-1", capabilityId: "invoke-figma-specification-agent" },
      modelCalls: [{ requestId: "request-1", status: "failure", errorCode: "ERR_MODEL_TIMEOUT" }],
    });
  });

  test("a started event opens a running trace", async () => {
    const { store, observer } = collector();

    await observer.onEvent(STARTED);

    const trace = await store.get("trace-1");
    expect(trace).toMatchObject({
      id: "trace-1",
      workerId: "design-engineer",
      agentId: "design-engineer-agent",
      status: "running",
      toolCalls: [],
    });
    expect(trace?.completedAt).toBeUndefined();
  });

  test("tool calls accumulate in order", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "tool.call.observed",
      traceId: "trace-1",
      toolId: "classify-design-task",
      durationMs: 2,
      status: "success",
      timestamp: "2026-08-01T10:00:01.000Z",
    });
    await observer.onEvent({
      type: "tool.call.observed",
      traceId: "trace-1",
      toolId: "project-summary",
      durationMs: 40,
      status: "failure",
      errorCode: "ERR_TOOL_TIMEOUT",
      timestamp: "2026-08-01T10:00:02.000Z",
    });

    const trace = await store.get("trace-1");
    expect(trace?.toolCalls).toEqual([
      { toolId: "classify-design-task", durationMs: 2, status: "success" },
      {
        toolId: "project-summary",
        durationMs: 40,
        status: "failure",
        errorCode: "ERR_TOOL_TIMEOUT",
      },
    ]);
    // Still open — a tool call is not an outcome.
    expect(trace?.status).toBe("running");
  });

  test("a completed event closes the trace with the decision", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "agent.decision.completed",
      traceId: "trace-1",
      decisionType: "run_workflow",
      workflowId: "design-to-code",
      durationMs: 3_200,
      timestamp: "2026-08-01T10:00:03.200Z",
    });

    expect(await store.get("trace-1")).toMatchObject({
      status: "completed",
      decisionType: "run_workflow",
      workflowId: "design-to-code",
      durationMs: 3_200,
      completedAt: "2026-08-01T10:00:03.200Z",
    });
  });

  test("a failed event closes the trace with a code", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "agent.decision.failed",
      traceId: "trace-1",
      errorCode: "ERR_AGENT_DECISION_INVALID",
      durationMs: 5,
      timestamp: "2026-08-01T10:00:00.005Z",
    });

    const trace = await store.get("trace-1");
    expect(trace?.status).toBe("failed");
    expect(trace?.errorCode).toBe("ERR_AGENT_DECISION_INVALID");
    // No decision was reached, so there is none to record.
    expect(trace?.decisionType).toBeUndefined();
  });

  test("a clarification closes without a workflow", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "agent.decision.completed",
      traceId: "trace-1",
      decisionType: "request_clarification",
      durationMs: 4,
      timestamp: "2026-08-01T10:00:00.004Z",
    });

    const trace = await store.get("trace-1");
    expect(trace?.decisionType).toBe("request_clarification");
    expect(trace?.workflowId).toBeUndefined();
    // No execution either — which is exactly why engine history cannot answer
    // questions about clarifications and this can.
    expect(trace?.executionId).toBeUndefined();
  });

  test("events for an unknown trace are ignored rather than fatal", async () => {
    const { store, observer } = collector();

    await observer.onEvent({
      type: "agent.decision.completed",
      traceId: "never-started",
      decisionType: "decline",
      durationMs: 1,
      timestamp: "2026-08-01T10:00:00.001Z",
    });

    expect(await store.get("never-started")).toBeNull();
  });

  test("a malformed event is refused before it reaches the store", async () => {
    const { store, observer } = collector();

    await expect(
      observer.onEvent({ type: "agent.decision.started", traceId: "x" } as TraceEvent),
    ).rejects.toThrow();

    expect(await store.list()).toEqual([]);
  });
});

// ── 11/12/13/14. What a trace cannot contain ────────────────────

describe("what a completed trace holds", () => {
  /** A realistic decision, with secrets in every place one could travel. */
  async function realistic(): Promise<AgentTrace> {
    const { store, observer } = collector();

    await observer.onEvent(STARTED);
    await observer.onEvent({
      type: "tool.call.observed",
      traceId: "trace-1",
      toolId: "classify-design-task",
      durationMs: 2,
      status: "success",
      timestamp: "2026-08-01T10:00:01.000Z",
    });
    await observer.onEvent({
      type: "agent.decision.completed",
      traceId: "trace-1",
      decisionType: "run_workflow",
      workflowId: "design-to-code",
      durationMs: 3_200,
      timestamp: "2026-08-01T10:00:03.200Z",
    });

    const trace = await store.get("trace-1");
    if (trace === null) throw new Error("expected a trace");
    return trace;
  }

  test("exactly the fields the schema names, and no others", async () => {
    expect(Object.keys(await realistic()).sort()).toEqual([
      "agentId",
      "completedAt",
      "coordinatorDiagnostics",
      "decisionType",
      "durationMs",
      "id",
      "modelCalls",
      "startedAt",
      "status",
      "toolCalls",
      "workerId",
      "workflowId",
    ]);
  });

  test("nothing resembling a prompt, reasoning or a payload", async () => {
    const serialized = JSON.stringify(await realistic());

    for (const forbidden of [
      "prompt",
      "reasoning",
      "chainOfThought",
      "thought",
      "message",
      "completion",
      "input",
      "output",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("metadata is left empty by everything this product writes", async () => {
    // The one open field. Nothing in DesignFlow populates it, and a trace that
    // arrived with something in it would be a host's doing, not ours.
    expect((await realistic()).metadata).toBeUndefined();
  });
});

// ── 17/18. Store behaviour ──────────────────────────────────────

describe("InMemoryTraceStore", () => {
  const trace: AgentTrace = {
    id: "t1",
    workerId: "w",
    agentId: "a",
    startedAt: "2026-08-01T10:00:00.000Z",
    status: "running",
    toolCalls: [],
  };

  test("round-trips a trace", async () => {
    const store = new InMemoryTraceStore();
    await store.create(trace);

    expect(await store.get("t1")).toMatchObject({ id: "t1" });
    expect(await store.get("nope")).toBeNull();
  });

  test("lists and filters", async () => {
    const store = new InMemoryTraceStore();
    await store.create(trace);
    await store.create({ ...trace, id: "t2", workerId: "other" });

    expect(await store.list()).toHaveLength(2);
    expect((await store.list({ workerId: "other" })).map((t) => t.id)).toEqual(["t2"]);
  });

  test("update merges rather than replaces", async () => {
    const store = new InMemoryTraceStore();
    await store.create(trace);

    await store.update("t1", { status: "completed", durationMs: 5 });

    const updated = await store.get("t1");
    expect(updated?.status).toBe("completed");
    // Identity survived the patch.
    expect(updated?.workerId).toBe("w");
    expect(updated?.startedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  test("refuses a trace that does not satisfy the schema", async () => {
    const store = new InMemoryTraceStore();

    await expect(store.create({ ...trace, id: "" })).rejects.toThrow();
    await expect(
      store.create({ ...trace, reasoning: "..." } as unknown as AgentTrace),
    ).rejects.toThrow();
  });
});

// ── Product read API ────────────────────────────────────────────

describe("TraceService", () => {
  async function seeded(): Promise<{ store: TraceStore; service: TraceService }> {
    const store = new InMemoryTraceStore();
    const service = new TraceService(store);
    const observer = new TraceCollector(store);

    await observer.onEvent(STARTED);
    await observer.onEvent({
      type: "agent.decision.completed",
      traceId: "trace-1",
      decisionType: "run_workflow",
      workflowId: "design-to-code",
      durationMs: 10,
      timestamp: "2026-08-01T10:00:00.010Z",
    });

    return { store, service };
  }

  test("gets a trace by id", async () => {
    const { service } = await seeded();

    expect((await service.getTrace("trace-1"))?.workflowId).toBe("design-to-code");
    expect(await service.getTrace("missing")).toBeNull();
  });

  test("lists traces", async () => {
    const { service } = await seeded();

    expect(await service.listTraces()).toHaveLength(1);
  });

  // ── 9. Correlation ────────────────────────────────────────────

  test("correlates a decision with the run it produced", async () => {
    const { service } = await seeded();

    await service.correlate("trace-1", "exec-99");

    expect((await service.getTrace("trace-1"))?.executionId).toBe("exec-99");
  });

  test("finds a trace from the execution id", async () => {
    const { service } = await seeded();
    await service.correlate("trace-1", "exec-99");

    // The bridge in the other direction: given a run, what decided it?
    expect((await service.getExecutionTrace("exec-99"))?.id).toBe("trace-1");
  });

  test("a run with no agent behind it has no trace", async () => {
    const { service } = await seeded();

    // The honest answer for a workflow started directly: there is no decision
    // to explain, rather than an empty one.
    expect(await service.getExecutionTrace("started-directly")).toBeNull();
  });

  test("exposes reads and correlation, and no other write", () => {
    const surface = Object.getOwnPropertyNames(TraceService.prototype).sort();

    // A surface that could create or patch traces could make the record say
    // whatever it liked, which is not an audit record.
    expect(surface).toEqual([
      "annotate",
      "constructor",
      "correlate",
      "getExecutionTrace",
      "getTrace",
      "listTraces",
    ]);
  });
});

// ── Model call collection ────────────────────────────────────────

describe("building a trace with model calls", () => {
  test("Coordinator diagnostics accumulate as bounded structural facts", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "agent.coordinator.output.invalid",
      traceId: "trace-1",
      diagnostic: {
        attempt: 1,
        maxAttempts: 2,
        errorCode: "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID",
        schemaPath: "reason",
        returnedAction: "decline",
        allowedActions: ["create_specification", "prepare_implementation", "decline"],
        outputLength: 84,
        truncated: false,
      },
      timestamp: "2026-08-01T10:00:01.000Z",
    });

    expect((await store.get("trace-1"))?.coordinatorDiagnostics).toEqual([
      {
        attempt: 1,
        maxAttempts: 2,
        errorCode: "ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID",
        schemaPath: "reason",
        returnedAction: "decline",
        allowedActions: ["create_specification", "prepare_implementation", "decline"],
        outputLength: 84,
        truncated: false,
      },
    ]);
  });

  test("a completed model call is recorded with provider, model and usage", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "model.request.started",
      traceId: "trace-1",
      requestId: "req-1",
      profileId: "design-engineer-default",
      timestamp: "2026-08-01T10:00:01.000Z",
    });
    await observer.onEvent({
      type: "model.request.completed",
      traceId: "trace-1",
      requestId: "req-1",
      profileId: "design-engineer-default",
      providerId: "openrouter",
      model: "openai/gpt-4o-mini",
      durationMs: 320,
      usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
      timestamp: "2026-08-01T10:00:01.320Z",
    });

    const trace = await store.get("trace-1");
    expect(trace?.modelCalls).toEqual([
      {
        requestId: "req-1",
        profileId: "design-engineer-default",
        providerId: "openrouter",
        model: "openai/gpt-4o-mini",
        durationMs: 320,
        status: "success",
        usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
      },
    ]);
    // Still open — a model call is not the decision's own outcome.
    expect(trace?.status).toBe("running");
  });

  test("a failed model call is recorded with a code, no provider or model", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "model.request.failed",
      traceId: "trace-1",
      requestId: "req-1",
      profileId: "design-engineer-default",
      errorCode: "ERR_MODEL_TIMEOUT",
      durationMs: 30_000,
      timestamp: "2026-08-01T10:00:30.000Z",
    });

    const trace = await store.get("trace-1");
    expect(trace?.modelCalls).toEqual([
      {
        requestId: "req-1",
        profileId: "design-engineer-default",
        durationMs: 30_000,
        status: "failure",
        errorCode: "ERR_MODEL_TIMEOUT",
      },
    ]);
  });

  test("a started event alone leaves no partial entry behind", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "model.request.started",
      traceId: "trace-1",
      requestId: "req-1",
      profileId: "design-engineer-default",
      timestamp: "2026-08-01T10:00:01.000Z",
    });

    expect((await store.get("trace-1"))?.modelCalls).toEqual([]);
  });

  test("model and tool calls both accumulate on the same trace", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);

    await observer.onEvent({
      type: "tool.call.observed",
      traceId: "trace-1",
      toolId: "classify-design-task",
      durationMs: 2,
      status: "success",
      timestamp: "2026-08-01T10:00:01.000Z",
    });
    await observer.onEvent({
      type: "model.request.completed",
      traceId: "trace-1",
      requestId: "req-1",
      profileId: "design-engineer-default",
      providerId: "openrouter",
      model: "openai/gpt-4o-mini",
      durationMs: 300,
      timestamp: "2026-08-01T10:00:02.000Z",
    });

    const trace = await store.get("trace-1");
    expect(trace?.toolCalls).toHaveLength(1);
    expect(trace?.modelCalls).toHaveLength(1);
  });

  test("no prompt, completion, or usage-adjacent secret ever reaches the store", async () => {
    const { store, observer } = collector();
    await observer.onEvent(STARTED);
    await observer.onEvent({
      type: "model.request.completed",
      traceId: "trace-1",
      requestId: "req-1",
      profileId: "design-engineer-default",
      providerId: "openrouter",
      model: "openai/gpt-4o-mini",
      durationMs: 1,
      timestamp: "2026-08-01T10:00:01.000Z",
    });

    const serialized = JSON.stringify(await store.get("trace-1"));
    for (const forbidden of ["prompt", "message", "completion", "output", "content"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});

// ── DF-SPEC-06. Candidate provenance must survive persistence ────

describe("failed model candidates are persisted, not silently dropped", () => {
  test("a failed call keeps every candidate's code, duration and sanitized reason", async () => {
    const { store, observer } = collector();

    await observer.onEvent({
      type: "agent.invocation.started",
      traceId: "spec-candidates",
      workerId: "capability-invocation",
      agentId: "figma-specification-agent",
      timestamp: "2026-08-12T19:29:25.651Z",
    });

    // Field run 926a8b19's shape: one real completion, then an exhausted
    // chain. The exhausted call was previously rejected at persistence
    // because a duplicated strict schema did not accept `durationMs`, so the
    // trace kept the success and lost every candidate fact.
    await observer.onEvent({
      type: "model.request.completed",
      traceId: "spec-candidates",
      requestId: "call-1",
      profileId: "figma-specification-default",
      providerId: "designflow-managed",
      model: "openai/gpt-4o-mini",
      durationMs: 91_549,
      timestamp: "2026-08-12T19:31:00.000Z",
    });

    await observer.onEvent({
      type: "model.request.failed",
      traceId: "spec-candidates",
      requestId: "call-2",
      profileId: "figma-specification-default",
      errorCode: "ERR_MODEL_CANDIDATES_EXHAUSTED",
      durationMs: 246_093,
      previousFailures: [
        { model: "openai/gpt-4o-mini", code: "ERR_MODEL_TIMEOUT", durationMs: 145_000 },
        { model: "openai/gpt-5.6-luna", code: "ERR_MODEL_UNAVAILABLE", durationMs: 812, reason: "requested model is unavailable: not a valid model ID" },
        { model: "deepseek/deepseek-v4-pro", code: "ERR_MODEL_UNAVAILABLE", durationMs: 764, reason: "no endpoints found matching your data policy" },
      ],
      timestamp: "2026-08-12T19:35:03.000Z",
    });

    const trace = await store.get("spec-candidates") as AgentTrace;
    expect(trace.modelCalls).toHaveLength(2);
    const failed = trace.modelCalls[1]!;
    expect(failed.status).toBe("failure");
    expect(failed.previousFailures).toHaveLength(3);
    expect(failed.previousFailures?.[1]).toEqual({
      model: "openai/gpt-5.6-luna",
      code: "ERR_MODEL_UNAVAILABLE",
      durationMs: 812,
      reason: "requested model is unavailable: not a valid model ID",
    });
    // still no prompt, no output, no credential anywhere on the trace
    expect(JSON.stringify(trace)).not.toContain("Bearer");
  });

  test("evidence metrics land on the trace as counts only", async () => {
    const { store, observer } = collector();
    await observer.onEvent({
      type: "agent.invocation.started",
      traceId: "spec-evidence",
      workerId: "capability-invocation",
      agentId: "figma-specification-agent",
      timestamp: "2026-08-12T19:29:25.651Z",
    });
    await observer.onEvent({
      type: "agent.evidence.compiled",
      traceId: "spec-evidence",
      agentId: "figma-specification-agent",
      metrics: {
        snapshotNodeCount: 158,
        snapshotBytes: 48_583,
        bundleElementCount: 40,
        bundleComponentCount: 4,
        bundleInstanceCount: 16,
        bundleBytes: 24_073,
      },
      timestamp: "2026-08-12T19:29:26.000Z",
    });

    const trace = await store.get("spec-evidence") as AgentTrace;
    expect(trace.evidence?.bundleBytes).toBe(24_073);
    expect(trace.evidence?.snapshotNodeCount).toBe(158);
  });
});
