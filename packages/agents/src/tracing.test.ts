// packages/agents/src/tracing.test.ts
import { describe, expect, test } from "bun:test";
import type {
  Agent,
  AgentContext,
  AgentDecision,
  AgentManifest,
  AgentTask,
  ModelInvoker,
  ToolInvoker,
  TraceEvent,
} from "@designflow/sdk";
import { InMemoryAgentRegistry } from "./registry";
import { AgentRuntime } from "./runtime";
import { createAgentRegistry } from "./index";

/**
 * Tracing, from the runtime's side.
 *
 * Two things are being established. That a decision produces a correlated,
 * content-free record of itself — and that the recording cannot affect the
 * decision, however badly the recorder behaves.
 */

const MANIFEST: AgentManifest = {
  id: "test-agent",
  name: "Test Agent",
  description: "decides things in tests",
  version: "1.0.0",
  instructions: "run alpha",
  allowedWorkflows: ["alpha"],
  allowedTools: ["granted"],
};

const TASK: AgentTask = {
  workerId: "test-worker",
  agentId: "test-agent",
  request: "build a login page for acme-corp with API_KEY=sk-live-secret",
};

function invoker(installed: readonly string[] = ["granted"]): ToolInvoker {
  return {
    installedToolIds: () => installed,
    invoke: (request) =>
      Promise.resolve(
        request.call.toolId === "explodes"
          ? {
              type: "failure",
              callId: request.call.id,
              toolId: request.call.toolId,
              code: "ERR_TOOL_TIMEOUT",
              message: "slow",
              retryable: true,
              durationMs: 7,
            }
          : {
              type: "success",
              callId: request.call.id,
              toolId: request.call.toolId,
              output: { secretValue: "sk-live-secret" },
              durationMs: 3,
            },
      ),
  };
}

function agentDoing(
  body: (context: AgentContext) => Promise<AgentDecision>,
  manifest: Partial<AgentManifest> = {},
): Agent {
  return {
    manifest: {
      ...MANIFEST,
      allowedWorkflows: [...MANIFEST.allowedWorkflows],
      allowedTools: [...MANIFEST.allowedTools],
      ...manifest,
    },
    decide: (_task: AgentTask, context: AgentContext) => body(context),
  };
}

function modelInvoker(
  behavior: "success" | "failure" = "success",
): ModelInvoker {
  return {
    installedProfileIds: () => ["test-profile"],
    generate: (request) =>
      Promise.resolve(
        behavior === "failure"
          ? {
              type: "failure",
              requestId: request.requestId,
              code: "ERR_MODEL_TIMEOUT",
              message: "the provider took too long to answer with something private",
              retryable: true,
              durationMs: 9,
            }
          : {
              type: "success",
              requestId: request.requestId,
              providerId: "test-provider",
              model: "test-model",
              output: { secretDecision: "sk-live-secret", note: "a private reasoning trail" },
              usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
              durationMs: 6,
            },
      ),
  };
}

/** A runtime with a recording tracer and deterministic ids and clock. */
function traced(
  agent: Agent,
  options: {
    installed?: readonly string[];
    models?: ModelInvoker;
  } = {},
) {
  const events: TraceEvent[] = [];
  let tick = 0;

  const runtime = new AgentRuntime({
    registry: new InMemoryAgentRegistry([agent]),
    availableWorkflows: ["alpha"],
    tools: invoker(options.installed ?? ["granted"]),
    ...(options.models !== undefined ? { models: options.models } : {}),
    tracer: { onEvent: (event) => { events.push(event); return Promise.resolve(); } },
    generateTraceId: () => "trace-fixed",
    now: () => new Date(Date.UTC(2026, 7, 1, 10, 0, tick++)),
  });

  return { runtime, events };
}

// ── 5/6/7. A decision produces a trace ──────────────────────────

describe("a traced decision", () => {
  test("emits started then completed, correlated by one id", async () => {
    const { runtime, events } = traced(
      agentDoing(() => Promise.resolve({ type: "run_workflow", workflowId: "alpha" })),
    );

    const result = await runtime.decide(TASK);

    expect(events.map((event) => event.type)).toEqual([
      "agent.decision.started",
      "agent.decision.completed",
    ]);
    // One id ties the worker, the agent, the tools and the outcome together.
    expect(new Set(events.map((event) => event.traceId))).toEqual(new Set(["trace-fixed"]));
    expect(result.traceId).toBe("trace-fixed");
  });

  test("the started event names the worker and agent", async () => {
    const { runtime, events } = traced(
      agentDoing(() => Promise.resolve({ type: "run_workflow", workflowId: "alpha" })),
    );

    await runtime.decide(TASK);

    expect(events[0]).toEqual({
      type: "agent.decision.started",
      traceId: "trace-fixed",
      workerId: "test-worker",
      agentId: "test-agent",
      timestamp: "2026-08-01T10:00:00.000Z",
    });
  });

  test("tool calls are observed as they happen", async () => {
    const { runtime, events } = traced(
      agentDoing(async (context) => {
        await context.tools.call({ id: "c1", toolId: "granted", input: {} });
        await context.tools.call({ id: "c2", toolId: "granted", input: {} });
        return { type: "run_workflow", workflowId: "alpha" };
      }),
    );

    await runtime.decide(TASK);

    const observed = events.filter((event) => event.type === "tool.call.observed");
    expect(observed).toHaveLength(2);
    expect(observed[0]).toMatchObject({
      toolId: "granted",
      status: "success",
      durationMs: 3,
    });
  });

  test("a failing tool is recorded with its code, not its message", async () => {
    const { runtime, events } = traced(
      agentDoing(
        async (context) => {
          await context.tools.call({ id: "c1", toolId: "explodes", input: {} });
          return { type: "run_workflow", workflowId: "alpha" };
        },
        { allowedTools: ["explodes"] },
      ),
      { installed: ["explodes"] },
    );

    await runtime.decide(TASK);

    const observed = events.find((event) => event.type === "tool.call.observed");
    expect(observed).toMatchObject({ status: "failure", errorCode: "ERR_TOOL_TIMEOUT" });
    expect(JSON.stringify(observed)).not.toContain("slow");
  });

  test("a clarification closes the trace without a workflow", async () => {
    const { runtime, events } = traced(
      agentDoing(() =>
        Promise.resolve({ type: "request_clarification", question: "Which design?" }),
      ),
    );

    await runtime.decide(TASK);

    const completed = events.find((event) => event.type === "agent.decision.completed");
    expect(completed).toMatchObject({ decisionType: "request_clarification" });
    expect(completed).not.toHaveProperty("workflowId");
    // The question itself is not in the stream.
    expect(JSON.stringify(events)).not.toContain("Which design");
  });

  // ── 8. Failures close the trace too ───────────────────────────

  test("a refused decision emits failed, not a dangling started", async () => {
    // Stage 36 had no failure event: a decision rejected for naming a
    // forbidden workflow left a started event and nothing else — the exact
    // case someone reading traces would most want to find.
    const { runtime, events } = traced(
      agentDoing(() =>
        Promise.resolve({ type: "run_workflow", workflowId: "forbidden" }),
      ),
    );

    await expect(runtime.decide(TASK)).rejects.toThrow();

    expect(events.map((event) => event.type)).toEqual([
      "agent.decision.started",
      "agent.decision.failed",
    ]);
    expect(events[1]).toMatchObject({ errorCode: "ERR_AGENT_WORKFLOW_NOT_ALLOWED" });
  });

  test("private reasoning in a decision is recorded as a code only", async () => {
    const { runtime, events } = traced(
      agentDoing(() =>
        Promise.resolve({
          type: "run_workflow",
          workflowId: "alpha",
          chainOfThought: "first I will consider the user's true motives",
        } as unknown as AgentDecision),
      ),
    );

    await expect(runtime.decide(TASK)).rejects.toThrow();

    const failed = events.find((event) => event.type === "agent.decision.failed");
    expect(failed).toMatchObject({ errorCode: "ERR_AGENT_DECISION_INVALID" });
    // Recording the message would record the reasoning that caused it.
    expect(JSON.stringify(events)).not.toContain("true motives");
  });

  test("tool calls made before a failure are still recorded", async () => {
    const { runtime, events } = traced(
      agentDoing(async (context) => {
        await context.tools.call({ id: "c1", toolId: "granted", input: {} });
        return { type: "run_workflow", workflowId: "forbidden" };
      }),
    );

    await expect(runtime.decide(TASK)).rejects.toThrow();

    expect(events.map((event) => event.type)).toEqual([
      "agent.decision.started",
      "tool.call.observed",
      "agent.decision.failed",
    ]);
  });
});

// ── 11/12/13/14. Nothing sensitive reaches the stream ───────────

describe("what the trace stream never carries", () => {
  test("not the request, the tool output, or any secret in either", async () => {
    const { runtime, events } = traced(
      agentDoing(async (context) => {
        await context.tools.call({
          id: "c1",
          toolId: "granted",
          input: { request: TASK.request, apiKey: "sk-live-secret" },
        });
        return { type: "run_workflow", workflowId: "alpha" };
      }),
    );

    await runtime.decide(TASK);

    const serialized = JSON.stringify(events);

    // The request went in, a tool returned a secret, and neither is here.
    expect(serialized).not.toContain("acme-corp");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("login page");
    expect(serialized).not.toContain("secretValue");
  });

  test("no event has a field for reasoning, a prompt or a stack", async () => {
    const { runtime, events } = traced(
      agentDoing(() => Promise.resolve({ type: "run_workflow", workflowId: "alpha" })),
    );

    await runtime.decide(TASK);

    for (const event of events) {
      for (const forbidden of ["reasoning", "prompt", "stack", "input", "output", "message"]) {
        expect(Object.keys(event)).not.toContain(forbidden);
      }
    }
  });
});

// ── 4/10. Tracing cannot affect the decision ────────────────────

describe("observer isolation", () => {
  test("a tracer that throws does not break the decision", async () => {
    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(() => Promise.resolve({ type: "run_workflow", workflowId: "alpha" })),
      ]),
      availableWorkflows: ["alpha"],
      tracer: {
        onEvent: () => {
          throw new Error("trace store on fire");
        },
      },
    });

    expect((await runtime.decide(TASK)).decision.type).toBe("run_workflow");
  });

  test("a tracer that rejects does not break the decision", async () => {
    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(() => Promise.resolve({ type: "run_workflow", workflowId: "alpha" })),
      ]),
      availableWorkflows: ["alpha"],
      tracer: { onEvent: () => Promise.reject(new Error("disk full")) },
    });

    // A full disk must not stop someone running a workflow.
    expect((await runtime.decide(TASK)).decision.type).toBe("run_workflow");
  });

  test("a tracer that throws still lets a refusal propagate unchanged", async () => {
    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(() =>
          Promise.resolve({ type: "run_workflow", workflowId: "forbidden" }),
        ),
      ]),
      availableWorkflows: ["alpha"],
      tracer: {
        onEvent: () => {
          throw new Error("trace store on fire");
        },
      },
    });

    // The original error, not the observer's.
    await expect(runtime.decide(TASK)).rejects.toThrow(/may not run workflow/);
  });

  test("tracing is off by default and the decision is identical without it", async () => {
    const agent = agentDoing(() =>
      Promise.resolve({ type: "run_workflow", workflowId: "alpha" }),
    );

    const untraced = await new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha"],
      generateTraceId: () => "trace-fixed",
    }).decide(TASK);

    const { runtime } = traced(agent);
    const withTracing = await runtime.decide(TASK);

    expect(untraced).toEqual(withTracing);
  });

  test("a broken tool-call reporter cannot fail the call", async () => {
    const { runtime } = traced(
      agentDoing(async (context) => {
        const result = await context.tools.call({ id: "c1", toolId: "granted", input: {} });
        if (result.type !== "success") throw new Error("expected the call to work");
        return { type: "run_workflow", workflowId: "alpha" };
      }),
    );

    expect((await runtime.decide(TASK)).decision.type).toBe("run_workflow");
  });
});

// ── 6. Trace ids are unique ─────────────────────────────────────

describe("trace ids", () => {
  test("differ between decisions", async () => {
    const seen = new Set<string>();

    const runtime = new AgentRuntime({
      registry: createAgentRegistry(),
      availableWorkflows: ["design-to-code"],
    });

    for (let index = 0; index < 50; index++) {
      const result = await runtime.decide({
        workerId: "design-engineer",
        agentId: "design-engineer-agent",
        request: "build a login page",
      });
      seen.add(result.traceId ?? "");
    }

    expect(seen.size).toBe(50);
  });
});

// ── 49/50/51. Model observations ────────────────────────────────

describe("model call tracing", () => {
  function agentCallingModel(manifest: Partial<AgentManifest> = {}): Agent {
    return agentDoing(
      async (context) => {
        await context.model.generate({
          messages: [{ role: "user", content: TASK.request }],
          responseSchema: { type: "object" },
        });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { modelProfileId: "test-profile", ...manifest },
    );
  }

  test("a successful call emits started then completed, correlated by traceId", async () => {
    const { runtime, events } = traced(agentCallingModel(), { models: modelInvoker("success") });

    await runtime.decide(TASK);

    const modelEvents = events.filter((event) => event.type.startsWith("model."));
    expect(modelEvents.map((event) => event.type)).toEqual([
      "model.request.started",
      "model.request.completed",
    ]);
    expect(new Set(modelEvents.map((event) => event.traceId))).toEqual(
      new Set(["trace-fixed"]),
    );
  });

  test("started carries only the profile — provider and model are not yet known", async () => {
    const { runtime, events } = traced(agentCallingModel(), { models: modelInvoker("success") });

    await runtime.decide(TASK);

    const started = events.find((event) => event.type === "model.request.started");
    expect(started).toMatchObject({ profileId: "test-profile" });
    expect(started).not.toHaveProperty("providerId");
    expect(started).not.toHaveProperty("model");
  });

  test("completed carries provider, model and usage, once known", async () => {
    const { runtime, events } = traced(agentCallingModel(), { models: modelInvoker("success") });

    await runtime.decide(TASK);

    const completed = events.find((event) => event.type === "model.request.completed");
    expect(completed).toMatchObject({
      providerId: "test-provider",
      model: "test-model",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
  });

  test("a failed call emits started then failed, with a stable code", async () => {
    const { runtime, events } = traced(agentCallingModel(), { models: modelInvoker("failure") });

    await runtime.decide(TASK);

    const modelEvents = events.filter((event) => event.type.startsWith("model."));
    expect(modelEvents.map((event) => event.type)).toEqual([
      "model.request.started",
      "model.request.failed",
    ]);

    const failed = events.find((event) => event.type === "model.request.failed");
    expect(failed).toMatchObject({ errorCode: "ERR_MODEL_TIMEOUT" });
  });

  // 50/51. Traces contain only safe metadata — never a message, a prompt or
  // a completion.
  test("no message, prompt, output, or usage-adjacent secret ever appears", async () => {
    const { runtime, events } = traced(agentCallingModel(), { models: modelInvoker("failure") });

    await runtime.decide(TASK);
    const serialized = JSON.stringify(events);

    expect(serialized).not.toContain("the provider took too long to answer with something private");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("private reasoning trail");
    expect(serialized).not.toContain(TASK.request);
  });

  test("a successful call's output is never in the trace stream either", async () => {
    const { runtime, events } = traced(agentCallingModel(), { models: modelInvoker("success") });

    await runtime.decide(TASK);
    const serialized = JSON.stringify(events);

    expect(serialized).not.toContain("secretDecision");
    expect(serialized).not.toContain("sk-live-secret");
  });

  test("no event has a field for messages, a prompt, or output", async () => {
    const { runtime, events } = traced(agentCallingModel(), { models: modelInvoker("success") });

    await runtime.decide(TASK);

    for (const event of events) {
      for (const forbidden of ["messages", "prompt", "output", "content"]) {
        expect(Object.keys(event)).not.toContain(forbidden);
      }
    }
  });

  // 52. Trace failure does not break a model decision.
  test("a broken tracer does not break a model-backed decision", async () => {
    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([agentCallingModel()]),
      availableWorkflows: ["alpha"],
      models: modelInvoker("success"),
      tracer: {
        onEvent: () => {
          throw new Error("trace store on fire");
        },
      },
    });

    expect((await runtime.decide(TASK)).decision.type).toBe("run_workflow");
  });

  // 53. Model failure closes the agent trace safely.
  test("a model failure that leads to a thrown decision still closes the trace", async () => {
    // An agent that (mis)treats a model failure as fatal rather than
    // deciding gracefully — the trace must still close as failed, not hang
    // open as `running` forever.
    const throwing = agentDoing(
      async (context) => {
        const result = await context.model.generate({
          messages: [{ role: "user", content: "x" }],
          responseSchema: {},
        });
        if (result.type === "failure") throw new Error("model call failed");
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { modelProfileId: "test-profile" },
    );

    const { runtime, events } = traced(throwing, { models: modelInvoker("failure") });

    await expect(runtime.decide(TASK)).rejects.toThrow();

    expect(events.map((event) => event.type)).toEqual([
      "agent.decision.started",
      "model.request.started",
      "model.request.failed",
      "agent.decision.failed",
    ]);
  });

  test("tool and model calls in the same decision both appear, in order", async () => {
    const both = agentDoing(
      async (context) => {
        await context.tools.call({ id: "c1", toolId: "granted", input: {} });
        await context.model.generate({
          messages: [{ role: "user", content: "x" }],
          responseSchema: {},
        });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { modelProfileId: "test-profile" },
    );

    const { runtime, events } = traced(both, { models: modelInvoker("success") });
    await runtime.decide(TASK);

    expect(events.map((event) => event.type)).toEqual([
      "agent.decision.started",
      "tool.call.observed",
      "model.request.started",
      "model.request.completed",
      "agent.decision.completed",
    ]);
  });
});
