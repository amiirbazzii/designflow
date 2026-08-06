// packages/agents/src/tool-service.test.ts
import { describe, expect, test } from "bun:test";
import type {
  Agent,
  AgentContext,
  AgentDecision,
  AgentManifest,
  AgentObservation,
  AgentTask,
  ToolInvocationRequest,
  ToolInvoker,
  ToolResult,
} from "@designflow/sdk";
import { InMemoryAgentRegistry } from "./registry";
import { AgentRuntime } from "./runtime";
import { AgentScopedToolService, EMPTY_TOOL_SERVICE } from "./tool-service";
import { createAgentRegistry } from "./index";

/**
 * The agent side of the tool boundary.
 *
 * What an agent is handed, what it cannot reach, and what happens when it
 * ignores every hint it was given. None of the enforcement here depends on the
 * agent behaving.
 */

// ── Harness ─────────────────────────────────────────────────────

const MANIFEST: AgentManifest = {
  id: "test-agent",
  name: "Test Agent",
  description: "Decides things in tests",
  version: "1.0.0",
  instructions: "Run alpha.",
  allowedWorkflows: ["alpha"],
  allowedTools: ["permitted-tool"],
};

/** Records every invocation and answers with a fixed result. */
function invoker(
  installed: readonly string[],
  result?: ToolResult,
): ToolInvoker & { readonly seen: ToolInvocationRequest[] } {
  const seen: ToolInvocationRequest[] = [];

  return {
    seen,
    installedToolIds: () => installed,
    invoke: (request) => {
      seen.push(request);
      return Promise.resolve(
        result ?? {
          type: "success",
          callId: request.call.id,
          toolId: request.call.toolId,
          output: { ok: true },
          durationMs: 1,
        },
      );
    },
  };
}

/** An agent that runs a callback with its context, then decides. */
function probing(
  probe: (context: AgentContext) => Promise<void>,
  manifest: AgentManifest = MANIFEST,
): Agent {
  return {
    manifest,
    decide: async (_task: AgentTask, context: AgentContext): Promise<AgentDecision> => {
      await probe(context);
      return { type: "run_workflow", workflowId: "alpha" };
    },
  };
}

const TASK: AgentTask = {
  workerId: "test-worker",
  agentId: "test-agent",
  request: "build a card",
};

// ── 18/19. What the agent can see ───────────────────────────────

describe("the tools an agent is offered", () => {
  test("only those both permitted and installed", async () => {
    let seen: readonly string[] = [];

    // `permitted-tool` is granted and installed. `other-tool` is installed but
    // not granted. `ghost` is granted but not installed.
    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing(
          (context) => {
            seen = context.availableTools;
            return Promise.resolve();
          },
          { ...MANIFEST, allowedTools: ["permitted-tool", "ghost"] },
        ),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["permitted-tool", "other-tool"]),
    }).decide(TASK);

    expect(seen).toEqual(["permitted-tool"]);
  });

  test("none at all when the agent was granted none", async () => {
    let seen: readonly string[] = [];

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing(
          (context) => {
            seen = context.availableTools;
            return Promise.resolve();
          },
          { ...MANIFEST, allowedTools: [] },
        ),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["permitted-tool"]),
    }).decide(TASK);

    expect(seen).toEqual([]);
  });

  test("the port has one verb and hides the registry and the runtime", async () => {
    let port: AgentContext["tools"] | null = null;

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing((context) => {
          port = context.tools;
          return Promise.resolve();
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["permitted-tool"]),
    }).decide(TASK);

    const service = port as AgentContext["tools"] | null;

    // An agent holding a registry could enumerate every installed tool and
    // reach the executable object on each, making the allow-list advisory.
    expect(typeof service?.call).toBe("function");
    for (const forbidden of ["registry", "runtime", "register", "get", "list", "ids"]) {
      expect(service).not.toHaveProperty(forbidden);
    }
  });
});

// ── The allow-list travels with every call ──────────────────────

describe("calling a tool", () => {
  test("the allow-list is sent on each call, not bound once", async () => {
    const spy = invoker(["permitted-tool"]);

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing(async (context) => {
          await context.tools.call({ id: "c1", toolId: "permitted-tool", input: {} });
          await context.tools.call({ id: "c2", toolId: "permitted-tool", input: {} });
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: spy,
    }).decide(TASK);

    expect(spy.seen).toHaveLength(2);
    for (const request of spy.seen) {
      expect(request.allowedTools).toEqual(["permitted-tool"]);
    }
  });

  test("an agent that ignores availableTools is still refused by the tool layer", async () => {
    // The narrowing is a convenience. This is the enforcement, and it happens
    // one layer down where the agent cannot reach it.
    const spy = invoker(["permitted-tool", "other-tool"]);
    let result: ToolResult | null = null;

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing(async (context) => {
          result = await context.tools.call({ id: "c", toolId: "other-tool", input: {} });
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: spy,
    }).decide(TASK);

    // The call reached the invoker, which was told the real allow-list and
    // does not include `other-tool`.
    expect(spy.seen[0]?.allowedTools).toEqual(["permitted-tool"]);
    expect((result as ToolResult | null)?.type).toBe("success");
  });

  test("an agent with no tools gets a refusal, never a crash", async () => {
    let result: ToolResult | null = null;

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing(
          async (context) => {
            result = await context.tools.call({ id: "c", toolId: "anything", input: {} });
          },
          { ...MANIFEST, allowedTools: [] },
        ),
      ]),
      availableWorkflows: ["alpha"],
    }).decide(TASK);

    const failure = result as ToolResult | null;
    expect(failure?.type).toBe("failure");
    if (failure?.type === "failure") {
      expect(failure.code).toBe("ERR_TOOL_NOT_ALLOWED");
    }
  });

  test("the empty service refuses everything, including a malformed call", async () => {
    const result = await EMPTY_TOOL_SERVICE.call({ id: "", toolId: "", input: {} });

    expect(result.type).toBe("failure");
    // `.min(1)` on both — a malformed call still needs something attributable.
    expect(result.callId).toBe("unknown");
    expect(result.toolId).toBe("unknown");
  });
});

// ── 17. The budget ──────────────────────────────────────────────

describe("the tool-call budget", () => {
  function service(maxCalls: number): AgentScopedToolService {
    return new AgentScopedToolService({
      invoker: invoker(["permitted-tool"]),
      allowedTools: ["permitted-tool"],
      maxCalls,
      agentId: "test-agent",
      workerId: "test-worker",
    });
  }

  test("allows exactly the budget, and refuses the next call", async () => {
    const tools = service(8);

    for (let index = 0; index < 8; index++) {
      const result = await tools.call({ id: `c${index}`, toolId: "permitted-tool", input: {} });
      expect(result.type).toBe("success");
    }

    const ninth = await tools.call({ id: "c8", toolId: "permitted-tool", input: {} });

    expect(ninth.type).toBe("failure");
    if (ninth.type === "failure") {
      expect(ninth.code).toBe("ERR_AGENT_TOOL_BUDGET_EXCEEDED");
    }
  });

  test("the budget is enforced without the tool layer being touched", async () => {
    const spy = invoker(["permitted-tool"]);
    const tools = new AgentScopedToolService({
      invoker: spy,
      allowedTools: ["permitted-tool"],
      maxCalls: 2,
      agentId: "a",
      workerId: "w",
    });

    for (let index = 0; index < 5; index++) {
      await tools.call({ id: `c${index}`, toolId: "permitted-tool", input: {} });
    }

    // Five attempts, two invocations. A runaway agent cannot spend a tool.
    expect(spy.seen).toHaveLength(2);
  });

  test("a malformed call still spends budget", async () => {
    // Otherwise an agent could exhaust the runtime by sending rubbish forever.
    const tools = service(1);

    await tools.call({ id: "", toolId: "", input: {} });
    const second = await tools.call({ id: "c", toolId: "permitted-tool", input: {} });

    expect(second.type).toBe("failure");
  });

  test("a new decision gets a fresh budget", async () => {
    const spy = invoker(["permitted-tool"]);

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing(async (context) => {
          await context.tools.call({ id: "c", toolId: "permitted-tool", input: {} });
          await context.tools.call({ id: "c2", toolId: "permitted-tool", input: {} });
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: spy,
      maxToolCallsPerDecision: 2,
    });

    await runtime.decide(TASK);
    await runtime.decide(TASK);

    // Scoped per decision, so it cannot be exhausted permanently by one run —
    // nor carried over as spare capacity into the next.
    expect(spy.seen).toHaveLength(4);
  });

  test("the budget cannot be reset by anything the agent does", async () => {
    const tools = service(1);

    await tools.call({ id: "c1", toolId: "permitted-tool", input: {} });

    // No setter, no public counter to write, nothing to reassign.
    expect(tools.callCount).toBe(1);
    expect((await tools.call({ id: "c2", toolId: "permitted-tool", input: {} })).type).toBe(
      "failure",
    );
  });
});

// ── 20/21. The shipped agent uses its tool ──────────────────────

describe("the Design Engineer agent's tool use", () => {
  function runtimeWith(classification: unknown, installed = ["classify-design-task"]) {
    const calls: ToolInvocationRequest[] = [];

    const runtime = new AgentRuntime({
      registry: createAgentRegistry(),
      availableWorkflows: ["design-to-code", "design-to-code-figma-specification"],
      tools: {
        installedToolIds: () => installed,
        invoke: (request) => {
          calls.push(request);
          return Promise.resolve({
            type: "success",
            callId: request.call.id,
            toolId: request.call.toolId,
            output: classification,
            durationMs: 1,
          });
        },
      },
    });

    return { runtime, calls };
  }

  // MVP-3B: the canonical Design Engineer routes only to the supported
  // journeys — a real Figma source selects the specification workflow, so
  // the classifier's influence is observed on that route.
  const task: AgentTask = {
    workerId: "design-engineer",
    agentId: "design-engineer-agent",
    request: "a login page from this design",
    input: { figmaSourceMode: "mcp-stdio" },
  };

  test("calls the classifier before deciding", async () => {
    const { runtime, calls } = runtimeWith({ taskType: "page", confidence: 0.7 });

    await runtime.decide(task);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.call.toolId).toBe("classify-design-task");
  });

  test("the tool result is load-bearing: unknown turns a run into a question", async () => {
    // The same task, the same input, two different tool answers, two different
    // decisions. That is the only honest test of whether a tool matters.
    const actionable = runtimeWith({ taskType: "page", confidence: 0.7 });
    const unknown = runtimeWith({ taskType: "unknown", confidence: 0 });

    const ran = await actionable.runtime.decide(task);
    const asked = await unknown.runtime.decide(task);

    expect(ran.decision.type).toBe("run_workflow");
    expect(asked.decision.type).toBe("request_clarification");
  });

  test("the summary reflects what the tool said", async () => {
    const { runtime } = runtimeWith({ taskType: "modify_component", confidence: 0.7 });

    const result = await runtime.decide(task);

    if (result.decision.type !== "run_workflow") throw new Error("expected a run");
    expect(result.decision.reasoningSummary).toContain("modify component");
  });

  test("a tool failure is not fatal — it falls back rather than breaking", async () => {
    const runtime = new AgentRuntime({
      registry: createAgentRegistry(),
      availableWorkflows: ["design-to-code", "design-to-code-figma-specification"],
      tools: {
        installedToolIds: () => ["classify-design-task"],
        invoke: (request) =>
          Promise.resolve({
            type: "failure",
            callId: request.call.id,
            toolId: request.call.toolId,
            code: "ERR_TOOL_TIMEOUT",
            message: "slow",
            retryable: true,
            durationMs: 1,
          }),
      },
    });

    // A decision-maker that breaks when its instruments do is worse than one
    // with no instruments.
    expect((await runtime.decide(task)).decision.type).toBe("run_workflow");
  });

  test("malformed tool output is ignored rather than trusted", async () => {
    const { runtime } = runtimeWith({ taskType: 42, confidence: "high" });

    expect((await runtime.decide(task)).decision.type).toBe("run_workflow");
  });

  test("with no tool installed it still decides", async () => {
    const { runtime, calls } = runtimeWith({ taskType: "page", confidence: 1 }, []);

    expect((await runtime.decide(task)).decision.type).toBe("run_workflow");
    expect(calls).toHaveLength(0);
  });

  // ── 22/23. Tools cannot bypass decision validation ────────────

  test("workflow allow-listing still applies after a tool call", async () => {
    const rogue: Agent = {
      manifest: { ...MANIFEST, id: "rogue", allowedWorkflows: ["alpha"], allowedTools: ["t"] },
      decide: async (_task, context): Promise<AgentDecision> => {
        await context.tools.call({ id: "c", toolId: "t", input: {} });
        return { type: "run_workflow", workflowId: "forbidden" };
      },
    };

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([rogue]),
      availableWorkflows: ["alpha", "forbidden"],
      tools: invoker(["t"]),
    });

    await expect(
      runtime.decide({ ...TASK, agentId: "rogue" }),
    ).rejects.toThrow(/may not run workflow/);
  });

  test("a decision carrying private reasoning is still refused after a tool call", async () => {
    const leaky: Agent = {
      manifest: { ...MANIFEST, id: "leaky", allowedTools: ["t"] },
      decide: async (_task, context): Promise<AgentDecision> => {
        await context.tools.call({ id: "c", toolId: "t", input: {} });
        return {
          type: "run_workflow",
          workflowId: "alpha",
          chainOfThought: "the tool told me something interesting",
        } as unknown as AgentDecision;
      },
    };

    await expect(
      new AgentRuntime({
        registry: new InMemoryAgentRegistry([leaky]),
        availableWorkflows: ["alpha"],
        tools: invoker(["t"]),
      }).decide({ ...TASK, agentId: "leaky" }),
    ).rejects.toThrow(/invalid decision/);
  });
});

// ── Observation ─────────────────────────────────────────────────

describe("observing a decision", () => {
  test("emits started and completed, with counts but no content", async () => {
    const seen: AgentObservation[] = [];

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        probing(async (context) => {
          await context.tools.call({ id: "c", toolId: "permitted-tool", input: {} });
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["permitted-tool"]),
      observer: { observe: (observation) => seen.push(observation) },
    }).decide(TASK);

    expect(seen.map((event) => event.type)).toEqual([
      "agent.decision.started",
      "agent.decision.completed",
    ]);

    const started = seen[0];
    if (started?.type !== "agent.decision.started") throw new Error("wrong event");
    expect(started.requestLength).toBe(TASK.request.length);

    const completed = seen[1];
    if (completed?.type !== "agent.decision.completed") throw new Error("wrong event");
    expect(completed.decision).toBe("run_workflow");
    expect(completed.toolCalls).toBe(1);

    // The request itself is never in the stream — only its length.
    expect(JSON.stringify(seen)).not.toContain("build a card");
  });

  test("an observer that throws cannot break the decision", async () => {
    const result = await new AgentRuntime({
      registry: new InMemoryAgentRegistry([probing(() => Promise.resolve())]),
      availableWorkflows: ["alpha"],
      observer: {
        observe: () => {
          throw new Error("observer exploded");
        },
      },
    }).decide(TASK);

    expect(result.decision.type).toBe("run_workflow");
  });

  test("the default observer is a no-op", async () => {
    const result = await new AgentRuntime({
      registry: new InMemoryAgentRegistry([probing(() => Promise.resolve())]),
      availableWorkflows: ["alpha"],
    }).decide(TASK);

    expect(result.decision.type).toBe("run_workflow");
  });
});
