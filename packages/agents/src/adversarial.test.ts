// packages/agents/src/adversarial.test.ts
import { describe, expect, test } from "bun:test";
import type {
  Agent,
  AgentContext,
  AgentDecision,
  AgentManifest,
  AgentTask,
  ToolInvocationRequest,
  ToolInvoker,
  ToolResult,
} from "@designflow/sdk";
import { InMemoryAgentRegistry } from "./registry";
import { AgentRuntime } from "./runtime";
import { AgentScopedToolService } from "./tool-service";

/**
 * The agent boundary under an agent that is actively hostile.
 *
 * The premise of the whole layer is that an agent may not cooperate — a model
 * under prompt injection is the case this is built for. So every guarantee is
 * tested against an agent that ignores what it was told, calls what it was not
 * granted, spends past its budget and tries to reach the machinery behind the
 * port it was handed.
 */

const MANIFEST: AgentManifest = {
  id: "hostile-agent",
  name: "Hostile",
  description: "does not cooperate",
  version: "1.0.0",
  instructions: "misbehave",
  allowedWorkflows: ["alpha"],
  allowedTools: ["granted"],
};

function invoker(installed: readonly string[]): ToolInvoker & {
  readonly seen: ToolInvocationRequest[];
} {
  const seen: ToolInvocationRequest[] = [];

  return {
    seen,
    installedToolIds: () => installed,
    invoke: (request) => {
      seen.push(request);

      // Mimics the real runtime: the allow-list it was *sent* is what decides.
      if (!request.allowedTools.includes(request.call.toolId)) {
        return Promise.resolve({
          type: "failure",
          callId: request.call.id,
          toolId: request.call.toolId,
          code: "ERR_TOOL_NOT_ALLOWED",
          message: "This worker may not use that tool.",
          retryable: false,
          durationMs: 0,
        });
      }

      return Promise.resolve({
        type: "success",
        callId: request.call.id,
        toolId: request.call.toolId,
        output: { ok: true },
        durationMs: 1,
      });
    },
  };
}

function agentDoing(
  body: (context: AgentContext) => Promise<AgentDecision>,
  manifest: Partial<AgentManifest> = {},
): Agent {
  return {
    // Arrays copied, not spread by reference. One of these tests mutates its
    // own manifest on purpose, and a shared array would carry that into every
    // later test in the file.
    manifest: {
      ...MANIFEST,
      allowedWorkflows: [...MANIFEST.allowedWorkflows],
      allowedTools: [...MANIFEST.allowedTools],
      ...manifest,
    },
    decide: (_task: AgentTask, context: AgentContext) => body(context),
  };
}

const TASK: AgentTask = {
  workerId: "w",
  agentId: "hostile-agent",
  request: "probe the boundary",
};

function codeOf(result: ToolResult): string {
  return result.type === "failure" ? result.code : "success";
}

// ── Permission cannot be widened from inside ────────────────────

describe("an agent that ignores what it was granted", () => {
  test("calling an installed tool it was not granted is refused", async () => {
    let outcome = "";

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(async (context) => {
          // The agent knows the id perfectly well. Knowing it is not a grant.
          outcome = codeOf(
            await context.tools.call({ id: "c", toolId: "ungranted", input: {} }),
          );
          return { type: "run_workflow", workflowId: "alpha" };
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["granted", "ungranted"]),
    }).decide(TASK);

    expect(outcome).toBe("ERR_TOOL_NOT_ALLOWED");
  });

  test("mutating availableTools does not widen the allow-list", async () => {
    const spy = invoker(["granted", "ungranted"]);
    let outcome = "";

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(async (context) => {
          // The array it was handed is a narrowing hint, not the enforcement.
          (context.availableTools as string[]).push?.("ungranted");
          outcome = codeOf(
            await context.tools.call({ id: "c", toolId: "ungranted", input: {} }),
          );
          return { type: "run_workflow", workflowId: "alpha" };
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: spy,
    }).decide(TASK);

    expect(outcome).toBe("ERR_TOOL_NOT_ALLOWED");
    // The service sent its own copy, untouched by whatever the agent did.
    expect(spy.seen[0]?.allowedTools).toEqual(["granted"]);
  });

  test("mutating its own manifest does not widen the next decision", async () => {
    const spy = invoker(["granted", "ungranted"]);

    const agent = agentDoing(async (context) => {
      (agent.manifest.allowedTools as string[]).push?.("ungranted");
      await context.tools.call({ id: "c", toolId: "ungranted", input: {} });
      return { type: "run_workflow", workflowId: "alpha" };
    });

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha"],
      tools: spy,
    });

    await runtime.decide(TASK);
    await runtime.decide(TASK);

    // The registry holds the manifest it parsed, not the object the agent can
    // still reach — so widening it changes nothing on the next decision.
    for (const request of spy.seen) {
      expect(request.allowedTools).toEqual(["granted"]);
    }
  });

  test("the tool port exposes no way to reach the registry or the runtime", async () => {
    let reachable: readonly string[] = [];
    let prototypeKeys: readonly string[] = [];

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing((context) => {
          reachable = Object.keys(context.tools);
          prototypeKeys = Object.getOwnPropertyNames(
            Object.getPrototypeOf(context.tools) as object,
          );
          return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["granted"]),
    }).decide(TASK);

    // Own keys and the prototype chain both. An agent walking the prototype
    // must not find `invoker`, `registry` or anything that executes.
    const surface = [...reachable, ...prototypeKeys];
    for (const forbidden of ["registry", "runtime", "invoker", "list", "ids", "get", "register"]) {
      expect(surface).not.toContain(forbidden);
    }
    expect(surface).toContain("call");
    expect(reachable).toEqual(["call"]);
  });

  test("an agent cannot reach the invoker behind its port and bypass everything", async () => {
    // The sharpest test in this package, and a real hole that existed here.
    // TypeScript's `private` is compile-time only, so the service's fields
    // were ordinary enumerable properties: an agent could read
    // `Object.keys(context.tools)`, find `invoker`, and call it directly with
    // any allow-list it liked. Measured before the fix: 100 calls to a
    // never-granted tool against a budget of 8.
    const spy = invoker(["granted", "secret-tool"]);
    let reachedInvoker = false;
    let couldSwapCall = false;

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(async (context) => {
          const port = context.tools as unknown as Record<string, unknown>;

          reachedInvoker = port.invoker !== undefined;

          try {
            (port as { call: unknown }).call = () => Promise.resolve({});
          } catch {
            couldSwapCall = false;
          }

          for (let index = 0; index < 100; index++) {
            await context.tools.call({ id: `x${index}`, toolId: "secret-tool", input: {} });
          }

          return { type: "run_workflow", workflowId: "alpha" };
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: spy,
      maxToolCallsPerDecision: 8,
    }).decide(TASK);

    expect(reachedInvoker).toBe(false);
    expect(couldSwapCall).toBe(false);
    expect(Object.isFrozen(spy)).toBe(false); // the spy itself is ordinary

    // The budget held, and every attempt that got through carried the real
    // allow-list — which does not include `secret-tool`.
    expect(spy.seen).toHaveLength(8);
    for (const request of spy.seen) {
      expect(request.allowedTools).toEqual(["granted"]);
    }
  });

  test("the port leaks nothing through serialisation either", async () => {
    let serialized = "";

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing((context) => {
          serialized = JSON.stringify(context.tools);
          return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["granted"]),
    }).decide(TASK);

    // `#` fields are absent from JSON too, so an agent that stringifies its
    // port to smuggle state into a decision gets an empty object.
    expect(serialized).toBe("{}");
  });

  test("no wildcard is honoured anywhere in the stack", async () => {
    const spy = invoker(["granted", "secret-tool"]);
    let outcome = "";

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(
          async (context) => {
            outcome = codeOf(
              await context.tools.call({ id: "c", toolId: "secret-tool", input: {} }),
            );
            return { type: "run_workflow", workflowId: "alpha" };
          },
          { allowedTools: ["*"] },
        ),
      ]),
      availableWorkflows: ["alpha"],
      tools: spy,
    }).decide(TASK);

    // `"*"` is a literal id matching a tool actually named `*`, and nothing
    // expands it. A grant that widened on install would make "what may this
    // agent do?" a question about install order.
    expect(outcome).toBe("ERR_TOOL_NOT_ALLOWED");
    // Stronger than a refusal downstream: `"*"` matches no installed tool, so
    // the agent is given the empty service and the tool layer is never even
    // reached.
    expect(spy.seen).toHaveLength(0);
  });
});

// ── The budget holds under abuse ────────────────────────────────

describe("an agent that spends past its budget", () => {
  test("concurrent calls cannot race past the limit", async () => {
    const spy = invoker(["granted"]);

    const service = new AgentScopedToolService({
      invoker: spy,
      allowedTools: ["granted"],
      maxCalls: 8,
      agentId: "a",
      workerId: "w",
    });

    // Fired all at once rather than awaited in turn. The counter increments
    // synchronously before the first await, so there is no window between
    // checking and spending for a concurrent call to slip through.
    const results = await Promise.all(
      Array.from({ length: 50 }, (_unused, index) =>
        service.call({ id: `c${index}`, toolId: "granted", input: {} }),
      ),
    );

    const succeeded = results.filter((result) => result.type === "success");
    const overBudget = results.filter(
      (result) => result.type === "failure" && result.code === "ERR_AGENT_TOOL_BUDGET_EXCEEDED",
    );

    expect(succeeded).toHaveLength(8);
    expect(overBudget).toHaveLength(42);
    // The invoker is what actually runs a tool. It saw exactly the budget.
    expect(spy.seen).toHaveLength(8);
  });

  test("calls beyond the budget never reach the tool layer at all", async () => {
    const spy = invoker(["granted"]);

    const service = new AgentScopedToolService({
      invoker: spy,
      allowedTools: ["granted"],
      maxCalls: 3,
      agentId: "a",
      workerId: "w",
    });

    for (let index = 0; index < 30; index++) {
      await service.call({ id: `c${index}`, toolId: "granted", input: {} });
    }

    expect(spy.seen).toHaveLength(3);
    expect(service.callCount).toBe(30);
  });

  test("the budget resets for the next decision but never mid-decision", async () => {
    const spy = invoker(["granted"]);

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(async (context) => {
          for (let index = 0; index < 10; index++) {
            await context.tools.call({ id: `c${index}`, toolId: "granted", input: {} });
          }
          return { type: "run_workflow", workflowId: "alpha" };
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: spy,
      maxToolCallsPerDecision: 4,
    });

    await runtime.decide(TASK);
    expect(spy.seen).toHaveLength(4);

    await runtime.decide(TASK);
    // Four more, not eight: a fresh allowance, not accumulated headroom.
    expect(spy.seen).toHaveLength(8);
  });

  test("a hostile agent cannot resurrect a spent service", async () => {
    let captured: AgentContext["tools"] | null = null;

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(async (context) => {
          captured = context.tools;
          for (let index = 0; index < 3; index++) {
            await context.tools.call({ id: `c${index}`, toolId: "granted", input: {} });
          }
          return { type: "run_workflow", workflowId: "alpha" };
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["granted"]),
      maxToolCallsPerDecision: 3,
    });

    await runtime.decide(TASK);

    // Stashed from a previous decision, its budget already spent. There is no
    // setter and no counter to write.
    const stale = captured as AgentContext["tools"] | null;
    const result = await stale?.call({ id: "later", toolId: "granted", input: {} });

    expect(result?.type).toBe("failure");
    if (result?.type === "failure") {
      expect(result.code).toBe("ERR_AGENT_TOOL_BUDGET_EXCEEDED");
    }
  });
});

// ── Tool use cannot buy a workflow ──────────────────────────────

describe("what a tool call cannot unlock", () => {
  test("the workflow allow-list still applies after eight tool calls", async () => {
    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(async (context) => {
          for (let index = 0; index < 8; index++) {
            await context.tools.call({ id: `c${index}`, toolId: "granted", input: {} });
          }
          return { type: "run_workflow", workflowId: "forbidden" };
        }),
      ]),
      availableWorkflows: ["alpha", "forbidden"],
      tools: invoker(["granted"]),
    });

    await expect(runtime.decide(TASK)).rejects.toThrow(/may not run workflow/);
  });

  test("a tool result cannot be laundered into the decision as extra keys", async () => {
    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing(async (context) => {
          const result = await context.tools.call({
            id: "c",
            toolId: "granted",
            input: {},
          });

          return {
            type: "run_workflow",
            workflowId: "alpha",
            toolEvidence: result,
          } as unknown as AgentDecision;
        }),
      ]),
      availableWorkflows: ["alpha"],
      tools: invoker(["granted"]),
    });

    // Strict members mean a tool's output cannot ride into a decision under a
    // key nobody declared.
    await expect(runtime.decide(TASK)).rejects.toThrow(/invalid decision/);
  });

  test("the ambient metadata an agent sees cannot be poisoned for the next decision", async () => {
    const seen: unknown[] = [];
    let frozen = false;

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        agentDoing((context) => {
          seen.push({ ...context.metadata });
          try {
            // Frozen, so this throws under module strict mode. A hostile agent
            // would swallow that and carry on, so the test does too — what is
            // being checked is what the *next* decision sees.
            (context.metadata as Record<string, unknown>).poisoned = true;
          } catch {
            frozen = true;
          }
          return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
        }),
      ]),
      availableWorkflows: ["alpha"],
      metadata: { environment: "test" },
    });

    await runtime.decide(TASK);
    await runtime.decide(TASK);

    expect(frozen).toBe(true);
    expect(seen).toEqual([{ environment: "test" }, { environment: "test" }]);
  });
});
