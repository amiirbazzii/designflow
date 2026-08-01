// packages/sdk/src/trace.test.ts
import { describe, expect, test } from "bun:test";
import {
  agentTracePatchSchema,
  agentTraceSchema,
  selectTraces,
  traceEventSchema,
  traceFiltersSchema,
  NOOP_TRACE_OBSERVER,
} from "./trace";
import type { AgentTrace } from "./trace";

/**
 * The trace contracts.
 *
 * Most of these are about what the schemas refuse. A trace is an audit record
 * whose value rests entirely on a claim — "this cannot contain the prompt" —
 * and the only way to make that claim checkable is for there to be nowhere to
 * put one.
 */

const TRACE = {
  id: "trace-1",
  workerId: "design-engineer",
  agentId: "design-engineer-agent",
  startedAt: "2026-08-01T10:00:00.000Z",
  status: "running",
};

// ── 1. Trace schema ─────────────────────────────────────────────

describe("agentTraceSchema", () => {
  test("accepts a running trace and defaults its tool calls", () => {
    const trace = agentTraceSchema.parse(TRACE);

    expect(trace.id).toBe("trace-1");
    expect(trace.status).toBe("running");
    expect(trace.toolCalls).toEqual([]);
    expect(trace.executionId).toBeUndefined();
  });

  test("accepts a completed trace with everything filled in", () => {
    const trace = agentTraceSchema.parse({
      ...TRACE,
      executionId: "exec-1",
      completedAt: "2026-08-01T10:00:03.200Z",
      status: "completed",
      decisionType: "run_workflow",
      workflowId: "design-to-code",
      durationMs: 3_200,
      toolCalls: [
        { toolId: "classify-design-task", durationMs: 2, status: "success" },
      ],
    });

    expect(trace.decisionType).toBe("run_workflow");
    expect(trace.toolCalls).toHaveLength(1);
  });

  test("requires the identity fields", () => {
    for (const field of ["id", "workerId", "agentId", "startedAt", "status"] as const) {
      const { [field]: _removed, ...rest } = TRACE;
      expect(() => agentTraceSchema.parse(rest)).toThrow();
    }
  });

  test("rejects an unknown status or decision type", () => {
    expect(() => agentTraceSchema.parse({ ...TRACE, status: "pending" })).toThrow();
    expect(() =>
      agentTraceSchema.parse({ ...TRACE, decisionType: "call_tool" }),
    ).toThrow();
  });

  test("has nowhere to put a prompt, reasoning or a payload", () => {
    // The whole guarantee, and it is structural rather than a convention.
    for (const key of [
      "prompt",
      "prompts",
      "reasoning",
      "chainOfThought",
      "thoughts",
      "request",
      "input",
      "output",
      "toolInput",
      "toolOutput",
      "messages",
      "completion",
    ]) {
      expect(() => agentTraceSchema.parse({ ...TRACE, [key]: "secret" })).toThrow();
    }
  });

  test("a tool call records three facts and no payload", () => {
    const trace = agentTraceSchema.parse({
      ...TRACE,
      toolCalls: [{ toolId: "t", durationMs: 5, status: "failure", errorCode: "ERR_TOOL_TIMEOUT" }],
    });

    expect(Object.keys(trace.toolCalls[0] ?? {}).sort()).toEqual([
      "durationMs",
      "errorCode",
      "status",
      "toolId",
    ]);

    expect(() =>
      agentTraceSchema.parse({
        ...TRACE,
        toolCalls: [{ toolId: "t", durationMs: 5, status: "success", output: { a: 1 } }],
      }),
    ).toThrow();
  });

  test("refuses a negative duration and an empty id", () => {
    expect(() => agentTraceSchema.parse({ ...TRACE, durationMs: -1 })).toThrow();
    expect(() => agentTraceSchema.parse({ ...TRACE, id: "" })).toThrow();
  });
});

describe("agentTracePatchSchema", () => {
  test("accepts the fields a decision fills in over time", () => {
    const patch = agentTracePatchSchema.parse({
      status: "completed",
      decisionType: "decline",
      durationMs: 12,
      completedAt: "2026-08-01T10:00:01.000Z",
    });

    expect(patch.status).toBe("completed");
  });

  test("cannot be used to rewrite identity", () => {
    // A patch that could change `id`, `workerId` or `agentId` would let a
    // later write reassign a decision to a different worker.
    for (const key of ["id", "workerId", "agentId", "startedAt"]) {
      expect(() => agentTracePatchSchema.parse({ [key]: "x" })).toThrow();
    }
  });

  test("cannot smuggle a payload either", () => {
    expect(() => agentTracePatchSchema.parse({ reasoning: "..." })).toThrow();
  });
});

// ── 2. Event schemas ────────────────────────────────────────────

describe("traceEventSchema", () => {
  const STARTED = {
    type: "agent.decision.started",
    traceId: "trace-1",
    workerId: "w",
    agentId: "a",
    timestamp: "2026-08-01T10:00:00.000Z",
  };

  test("accepts all four events", () => {
    const events: readonly unknown[] = [
      STARTED,
      {
        type: "tool.call.observed",
        traceId: "trace-1",
        toolId: "t",
        durationMs: 2,
        status: "success",
        timestamp: "2026-08-01T10:00:01.000Z",
      },
      {
        type: "agent.decision.completed",
        traceId: "trace-1",
        decisionType: "run_workflow",
        workflowId: "design-to-code",
        durationMs: 3_200,
        timestamp: "2026-08-01T10:00:03.200Z",
      },
      {
        type: "agent.decision.failed",
        traceId: "trace-1",
        errorCode: "ERR_AGENT_DECISION_INVALID",
        durationMs: 5,
        timestamp: "2026-08-01T10:00:00.005Z",
      },
    ];

    for (const event of events) {
      expect(() => traceEventSchema.parse(event)).not.toThrow();
    }
  });

  test("every event carries the trace id that correlates it", () => {
    const { traceId: _removed, ...withoutTrace } = STARTED;
    expect(() => traceEventSchema.parse(withoutTrace)).toThrow();
  });

  test("rejects an unknown event type", () => {
    expect(() =>
      traceEventSchema.parse({ ...STARTED, type: "agent.reasoning.recorded" }),
    ).toThrow();
  });

  test("a failure carries a code and has nowhere for a message", () => {
    // `ERR_AGENT_DECISION_INVALID` is raised when an agent attached private
    // reasoning. Recording the message would record that reasoning.
    expect(() =>
      traceEventSchema.parse({
        type: "agent.decision.failed",
        traceId: "t",
        errorCode: "ERR_X",
        message: "agent said: first I will consider...",
        durationMs: 1,
        timestamp: "2026-08-01T10:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      traceEventSchema.parse({
        type: "agent.decision.failed",
        traceId: "t",
        errorCode: "ERR_X",
        stack: "Error\n    at x",
        durationMs: 1,
        timestamp: "2026-08-01T10:00:00.000Z",
      }),
    ).toThrow();
  });

  test("no event has room for a payload", () => {
    for (const key of ["input", "output", "request", "prompt", "reasoning"]) {
      expect(() =>
        traceEventSchema.parse({
          type: "tool.call.observed",
          traceId: "t",
          toolId: "t",
          durationMs: 1,
          status: "success",
          timestamp: "2026-08-01T10:00:00.000Z",
          [key]: "secret",
        }),
      ).toThrow();
    }
  });
});

// ── 3. Noop observer ────────────────────────────────────────────

describe("NOOP_TRACE_OBSERVER", () => {
  test("accepts any event and resolves", async () => {
    await expect(
      NOOP_TRACE_OBSERVER.onEvent({
        type: "agent.decision.started",
        traceId: "t",
        workerId: "w",
        agentId: "a",
        timestamp: "2026-08-01T10:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});

// ── Filtering ───────────────────────────────────────────────────

describe("selectTraces", () => {
  const traces: readonly AgentTrace[] = [
    agentTraceSchema.parse({ ...TRACE, id: "a", startedAt: "2026-08-01T10:00:00.000Z" }),
    agentTraceSchema.parse({
      ...TRACE,
      id: "b",
      startedAt: "2026-08-01T11:00:00.000Z",
      status: "completed",
      executionId: "exec-1",
    }),
    agentTraceSchema.parse({
      ...TRACE,
      id: "c",
      workerId: "other-worker",
      startedAt: "2026-08-01T12:00:00.000Z",
    }),
  ];

  test("returns most recent first", () => {
    expect(selectTraces(traces).map((trace) => trace.id)).toEqual(["c", "b", "a"]);
  });

  test("filters by worker, status and execution", () => {
    expect(selectTraces(traces, { workerId: "other-worker" }).map((t) => t.id)).toEqual(["c"]);
    expect(selectTraces(traces, { status: "completed" }).map((t) => t.id)).toEqual(["b"]);
    expect(selectTraces(traces, { executionId: "exec-1" }).map((t) => t.id)).toEqual(["b"]);
  });

  test("honours a limit after ordering, not before", () => {
    expect(selectTraces(traces, { limit: 2 }).map((t) => t.id)).toEqual(["c", "b"]);
  });

  test("rejects an unknown filter rather than ignoring it", () => {
    // A silently-ignored filter would return more than the caller asked for,
    // which for an audit view is the wrong direction to fail.
    expect(() => traceFiltersSchema.parse({ reasoning: "x" })).toThrow();
    expect(() => selectTraces(traces, { limit: 0 })).toThrow();
  });
});
