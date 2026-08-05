// packages/agents/src/invocation-runtime.test.ts
import { describe, expect, test } from "bun:test";
import {
  DesignFlowError,
  type AgentManifest,
  type ModelInvocationRequest,
  type ModelInvoker,
  type ModelResult,
  type SpecializedAgent,
  type ToolInvocationRequest,
  type ToolInvoker,
  type ToolResult,
  type TraceEvent,
} from "@designflow/sdk";

import { InMemorySpecializedAgentRegistry } from "./specialized-registry";
import { AgentInvocationRuntime } from "./invocation-runtime";
import { AgentInvocationRequestInvalidError } from "./errors";

const MANIFEST: AgentManifest = {
  id: "alpha-agent",
  name: "Alpha Agent",
  description: "Produces things in tests",
  version: "1.2.3",
  instructions: "Do the thing.",
  allowedWorkflows: ["some-workflow"],
  allowedTools: ["alpha-tool"],
  modelProfileId: "alpha-profile",
};

function agentThatPerformsWith(
  perform: SpecializedAgent["perform"],
  overrides: Partial<AgentManifest> = {},
): SpecializedAgent {
  return { manifest: { ...MANIFEST, ...overrides }, perform };
}

/**
 * A fake `ToolInvoker` that enforces `allowedTools` the way the real
 * `ToolRuntime` does — the scoped service passed the allow-list down on
 * every call rather than checking it itself, so a fake that skipped this
 * check would make "tool isolation" pass regardless of what
 * `AgentInvocationRuntime` actually narrowed `allowedTools` to.
 */
function fakeToolInvoker(installed: readonly string[]): ToolInvoker & {
  readonly seen: ToolInvocationRequest[];
} {
  const seen: ToolInvocationRequest[] = [];
  return {
    seen,
    installedToolIds: () => installed,
    invoke: async (request: ToolInvocationRequest): Promise<ToolResult> => {
      seen.push(request);

      if (!request.allowedTools.includes(request.call.toolId)) {
        return {
          type: "failure",
          callId: request.call.id,
          toolId: request.call.toolId,
          code: "ERR_TOOL_NOT_ALLOWED",
          message: "not allowed",
          retryable: false,
          durationMs: 1,
        };
      }

      return { type: "success", callId: request.call.id, toolId: request.call.toolId, output: {}, durationMs: 1 };
    },
  };
}

function fakeModelInvoker(installed: readonly string[]): ModelInvoker & {
  readonly seen: ModelInvocationRequest[];
} {
  const seen: ModelInvocationRequest[] = [];
  return {
    seen,
    installedProfileIds: () => installed,
    generate: async (request: ModelInvocationRequest): Promise<ModelResult> => {
      seen.push(request);
      return {
        type: "success",
        requestId: request.requestId,
        providerId: "test-provider",
        model: "test-model",
        output: { ok: true },
        durationMs: 1,
      };
    },
  };
}

describe("validating the request", () => {
  test("refuses a malformed request before resolving the agent", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async () => ({})),
    ]);
    const runtime = new AgentInvocationRuntime({ registry });

    await expect(
      runtime.invoke({ agentId: "", objective: "", input: undefined, attempt: 1 }),
    ).rejects.toThrow(AgentInvocationRequestInvalidError);
  });
});

describe("resolving output", () => {
  test("a successful perform produces a success outcome carrying provenance", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async () => ({ produced: true })),
    ]);
    const runtime = new AgentInvocationRuntime({ registry });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
    });

    expect(outcome).toMatchObject({
      type: "success",
      agentId: "alpha-agent",
      agentVersion: "1.2.3",
      output: { produced: true },
      attempt: 1,
    });
  });

  test("a thrown error becomes a failure outcome rather than propagating", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async () => {
        throw new Error("boom");
      }),
    ]);
    const runtime = new AgentInvocationRuntime({ registry });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
    });

    expect(outcome.type).toBe("failure");
    if (outcome.type === "failure") {
      expect(outcome.agentId).toBe("alpha-agent");
      expect(outcome.code.length).toBeGreaterThan(0);
    }
  });
});

describe("tool isolation", () => {
  test("an agent only ever sees its own allowed tools, never another agent's", async () => {
    let seenTools: readonly string[] = [];

    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async (_request, context) => {
        // Attempt a foreign tool — must be refused by the scoped service,
        // not merely absent from a list this agent chose to consult.
        const result = await context.tools.call({ id: "call-1", toolId: "beta-tool", input: {} });
        seenTools = [result.type];
        return { attempted: true };
      }),
    ]);

    const tools = fakeToolInvoker(["alpha-tool", "beta-tool"]);
    const runtime = new AgentInvocationRuntime({ registry, tools });

    await runtime.invoke({ agentId: "alpha-agent", objective: "test", input: {}, attempt: 1 });

    // The invoker is reached (enforcement is its job, not the scoped
    // service's), but it is told — on every call — an allow-list narrowed to
    // this agent's own manifest, so the foreign tool is refused.
    expect(tools.seen).toHaveLength(1);
    expect(tools.seen[0]?.allowedTools).toEqual(["alpha-tool"]);
    expect(seenTools).toEqual(["failure"]);
  });

  test("an agent's own allowed tool reaches the invoker", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async (_request, context) => {
        await context.tools.call({ id: "call-1", toolId: "alpha-tool", input: {} });
        return {};
      }),
    ]);

    const tools = fakeToolInvoker(["alpha-tool"]);
    const runtime = new AgentInvocationRuntime({ registry, tools });

    await runtime.invoke({ agentId: "alpha-agent", objective: "test", input: {}, attempt: 1 });

    expect(tools.seen).toHaveLength(1);
    expect(tools.seen[0]?.call.toolId).toBe("alpha-tool");
  });
});

describe("model isolation", () => {
  test("each agent resolves only its own model profile", async () => {
    let seenProfileId: string | undefined;

    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async (_request, context) => {
        const result = await context.model.generate({
          messages: [{ role: "user", content: "hi" }],
          responseSchema: {},
        });
        seenProfileId = result.type === "success" ? "alpha-profile" : undefined;
        return {};
      }),
    ]);

    const models = fakeModelInvoker(["alpha-profile"]);
    const runtime = new AgentInvocationRuntime({ registry, models });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
    });

    expect(models.seen).toHaveLength(1);
    expect(models.seen[0]?.profileId).toBe("alpha-profile");
    expect(seenProfileId).toBe("alpha-profile");
    expect(outcome.type === "success" && outcome.modelProfileId).toBe("alpha-profile");
  });

  test("an agent whose profile is not installed gets no model access", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async (_request, context) => {
        const result = await context.model.generate({
          messages: [{ role: "user", content: "hi" }],
          responseSchema: {},
        });
        return { failed: result.type === "failure" };
      }),
    ]);

    const models = fakeModelInvoker(["some-other-profile"]);
    const runtime = new AgentInvocationRuntime({ registry, models });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
    });

    expect(models.seen).toHaveLength(0);
    expect(outcome.type === "success" && outcome.output).toEqual({ failed: true });
  });

  test("live model mode reaches the configured model service", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async (_request, context) => {
        const result = await context.model.generate({
          messages: [{ role: "user", content: "bounded" }],
          responseSchema: { type: "object" },
        });
        return { modelSucceeded: result.type === "success" };
      }),
    ]);
    const models = fakeModelInvoker(["alpha-profile"]);
    const runtime = new AgentInvocationRuntime({ registry, models, modelsRequired: true });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
    });

    expect(outcome.type === "success" && outcome.output).toEqual({ modelSucceeded: true });
    expect(models.seen).toHaveLength(1);
  });

  test("missing model service is an explicit preflight failure", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async () => {
        throw new Error("must not perform");
      }),
    ]);
    const events: TraceEvent[] = [];
    const runtime = new AgentInvocationRuntime({
      registry,
      modelsRequired: true,
      tracer: { onEvent: async (event) => events.push(event) },
    });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
      metadata: { executionId: "exec-1", capabilityId: "cap-1" },
    });

    expect(outcome).toMatchObject({
      type: "failure",
      code: "ERR_AGENT_MODEL_SERVICE_UNAVAILABLE",
      message: "No model service is configured for this specialized agent.",
    });
    expect(events.map((event) => event.type)).toEqual([
      "agent.invocation.started",
      "agent.invocation.failed",
    ]);
    expect(events[0]).toMatchObject({
      type: "agent.invocation.started",
      metadata: { executionId: "exec-1", capabilityId: "cap-1" },
    });
  });

  test("missing model profile is rejected before perform", async () => {
    let performed = false;
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async () => {
        performed = true;
        return {};
      }),
    ]);
    const runtime = new AgentInvocationRuntime({
      registry,
      models: fakeModelInvoker(["other-profile"]),
      modelsRequired: true,
    });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
    });

    expect(outcome).toMatchObject({ type: "failure", code: "ERR_MODEL_PROFILE_NOT_FOUND" });
    expect(performed).toBe(false);
  });

  test("specialized model calls have a separate trace and safe failure code", async () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agentThatPerformsWith(async (_request, context) => {
        const result = await context.model.generate({
          messages: [{ role: "user", content: "bounded" }],
          responseSchema: { type: "object" },
        });
        if (result.type === "failure") throw new DesignFlowError(result.code, result.message);
        return {};
      }),
    ]);
    const models: ModelInvoker = {
      installedProfileIds: () => ["alpha-profile"],
      generate: async (request) => ({
        type: "failure" as const,
        requestId: request.requestId,
        code: "ERR_MODEL_TIMEOUT",
        message: "provider detail must not be persisted",
        retryable: true,
        durationMs: 4,
      }),
    };
    const events: TraceEvent[] = [];
    const runtime = new AgentInvocationRuntime({
      registry,
      models,
      modelsRequired: true,
      tracer: { onEvent: async (event) => events.push(event) },
    });

    const outcome = await runtime.invoke({
      agentId: "alpha-agent",
      objective: "test",
      input: {},
      attempt: 1,
    });

    expect(outcome).toMatchObject({ type: "failure", code: "ERR_MODEL_TIMEOUT" });
    expect(events.map((event) => event.type)).toEqual([
      "agent.invocation.started",
      "model.request.started",
      "model.request.failed",
      "agent.invocation.failed",
    ]);
    expect(JSON.stringify(events)).not.toContain("provider detail");
  });
});
