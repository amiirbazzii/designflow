// packages/agents/src/model-integration.test.ts
import { describe, expect, test } from "bun:test";
import type {
  Agent,
  AgentContext,
  AgentDecision,
  AgentManifest,
  AgentTask,
  ModelInvocationRequest,
  ModelInvoker,
  ModelResult,
} from "@designflow/sdk";
import { InMemoryAgentRegistry } from "./registry";
import { AgentRuntime } from "./runtime";

/**
 * `AgentRuntime`'s model integration, independent of any real agent — a
 * generic probing agent, so what is under test is the runtime's own scoping
 * and enforcement rather than the Design Engineer's particular logic.
 */

function manifest(overrides: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: "probe-agent",
    name: "Probe",
    description: "probes the model boundary",
    version: "1.0.0",
    instructions: "probe",
    allowedWorkflows: ["alpha"],
    allowedTools: [],
    ...overrides,
  };
}

function agentDoing(
  body: (context: AgentContext) => Promise<AgentDecision>,
  manifestOverrides: Partial<AgentManifest> = {},
): Agent {
  return { manifest: manifest(manifestOverrides), decide: (_task, context) => body(context) };
}

/** A fake `ModelInvoker` recording every request and answering per profile. */
function invokerWith(
  answers: Readonly<Record<string, unknown>>,
  installed: readonly string[] = Object.keys(answers),
): ModelInvoker & { readonly seen: ModelInvocationRequest[] } {
  const seen: ModelInvocationRequest[] = [];

  return {
    seen,
    installedProfileIds: () => installed,
    generate: (request) => {
      seen.push(request);
      const output = answers[request.profileId];

      return Promise.resolve(
        output === undefined
          ? {
              type: "failure",
              requestId: request.requestId,
              code: "ERR_MODEL_PROFILE_NOT_FOUND",
              message: "no such profile",
              retryable: false,
              durationMs: 0,
            }
          : {
              type: "success",
              requestId: request.requestId,
              providerId: "test-provider",
              model: "test-model",
              output,
              durationMs: 1,
            },
      );
    },
  };
}

const TASK: AgentTask = { workerId: "w", agentId: "probe-agent", request: "probe" };

// ── 12/13/14. Distinct profiles per agent ───────────────────────

describe("per-agent model profiles", () => {
  test("resolves the profile the agent's own manifest names", async () => {
    const models = invokerWith({ "profile-a": { via: "a" } });

    const agent = agentDoing(
      async (context) => {
        const result = await context.model.generate({
          messages: [{ role: "user", content: "x" }],
          responseSchema: {},
        });
        return {
          type: "decline",
          reason: JSON.stringify(result.type === "success" ? result.output : result),
        };
      },
      { modelProfileId: "profile-a" },
    );

    const result = await new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha"],
      models,
    }).decide(TASK);

    expect(models.seen[0]?.profileId).toBe("profile-a");
    expect(result.decision.type === "decline" ? result.decision.reason : "").toContain(
      '"via":"a"',
    );
  });

  test("agent A and agent B resolve different profiles, in one runtime", async () => {
    const models = invokerWith({ "profile-a": { via: "a" }, "profile-b": { via: "b" } });

    const probeA = agentDoing(
      async (context) => {
        await context.model.generate({ messages: [{ role: "user", content: "x" }], responseSchema: {} });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { id: "agent-a", modelProfileId: "profile-a" },
    );

    const probeB = agentDoing(
      async (context) => {
        await context.model.generate({ messages: [{ role: "user", content: "x" }], responseSchema: {} });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { id: "agent-b", modelProfileId: "profile-b" },
    );

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([probeA, probeB]),
      availableWorkflows: ["alpha"],
      models,
    });

    await runtime.decide({ ...TASK, agentId: "agent-a" });
    await runtime.decide({ ...TASK, agentId: "agent-b" });

    expect(models.seen.map((request) => request.profileId)).toEqual(["profile-a", "profile-b"]);
  });

  test("changing agent A's profile does not change agent B's calls", async () => {
    const models = invokerWith({
      "profile-a": { via: "a" },
      "profile-a-v2": { via: "a2" },
      "profile-b": { via: "b" },
    });

    const probeAv2 = agentDoing(
      async (context) => {
        await context.model.generate({ messages: [{ role: "user", content: "x" }], responseSchema: {} });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { id: "agent-a", modelProfileId: "profile-a-v2" },
    );

    const probeB = agentDoing(
      async (context) => {
        await context.model.generate({ messages: [{ role: "user", content: "x" }], responseSchema: {} });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { id: "agent-b", modelProfileId: "profile-b" },
    );

    const runtime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([probeAv2, probeB]),
      availableWorkflows: ["alpha"],
      models,
    });

    await runtime.decide({ ...TASK, agentId: "agent-a" });
    await runtime.decide({ ...TASK, agentId: "agent-b" });

    // Agent A's reassignment reached only agent A's own calls.
    expect(models.seen.map((request) => request.profileId)).toEqual([
      "profile-a-v2",
      "profile-b",
    ]);
  });

  // 15. Agent cannot request another agent's profile.
  test("an agent has no field through which to name a different profile", async () => {
    const models = invokerWith({ "profile-a": { via: "a" }, "profile-b": { via: "b" } });
    const spy = models;

    const rogue = agentDoing(
      async (context) => {
        // `AgentModelRequest` has no `profileId` field — this is the entire
        // request surface available, and it cannot express "use profile-b".
        await context.model.generate({
          messages: [{ role: "user", content: "x" }],
          responseSchema: {},
        });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { id: "rogue-agent", modelProfileId: "profile-a" },
    );

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([rogue]),
      availableWorkflows: ["alpha"],
      models: spy,
    }).decide({ ...TASK, agentId: "rogue-agent" });

    expect(spy.seen).toHaveLength(1);
    expect(spy.seen[0]?.profileId).toBe("profile-a");
  });

  test("an agent with no modelProfileId gets a service that always fails cleanly", async () => {
    const models = invokerWith({ "profile-a": { via: "a" } });

    let outcome: ModelResult | null = null;
    const noProfile = agentDoing(async (context) => {
      outcome = await context.model.generate({
        messages: [{ role: "user", content: "x" }],
        responseSchema: {},
      });
      return { type: "run_workflow", workflowId: "alpha" };
    });

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([noProfile]),
      availableWorkflows: ["alpha"],
      models,
    }).decide(TASK);

    expect(models.seen).toHaveLength(0);
    expect((outcome as ModelResult | null)?.type).toBe("failure");
  });

  test("a profile the agent names but the installation never registered fails cleanly", async () => {
    const models = invokerWith({ "profile-a": { via: "a" } });

    let outcome: ModelResult | null = null;
    const unresolved = agentDoing(
      async (context) => {
        outcome = await context.model.generate({
          messages: [{ role: "user", content: "x" }],
          responseSchema: {},
        });
        return { type: "run_workflow", workflowId: "alpha" };
      },
      { modelProfileId: "never-registered" },
    );

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([unresolved]),
      availableWorkflows: ["alpha"],
      models,
    }).decide(TASK);

    // Narrowed away before the call layer is even reached — the agent never
    // sees a profile it cannot use, the same as `availableTools`.
    expect(models.seen).toHaveLength(0);
    expect((outcome as ModelResult | null)?.type).toBe("failure");
  });
});

// ── 38/41. Enforcement survives a model-backed decision ─────────

describe("enforcement after a model call", () => {
  test("workflow allow-listing still applies to a model-influenced decision", async () => {
    const models = invokerWith({ "profile-a": { via: "a" } });

    const agent = agentDoing(
      async (context) => {
        await context.model.generate({
          messages: [{ role: "user", content: "x" }],
          responseSchema: {},
        });
        return { type: "run_workflow", workflowId: "forbidden" };
      },
      { modelProfileId: "profile-a", allowedWorkflows: ["alpha"] },
    );

    await expect(
      new AgentRuntime({
        registry: new InMemoryAgentRegistry([agent]),
        availableWorkflows: ["alpha", "forbidden"],
        models,
      }).decide(TASK),
    ).rejects.toThrow(/may not run workflow/);
  });

  test("a decision carrying extra keys is still refused after a model call", async () => {
    const models = invokerWith({ "profile-a": { via: "a" } });

    const leaky = agentDoing(
      async (context) => {
        await context.model.generate({
          messages: [{ role: "user", content: "x" }],
          responseSchema: {},
        });
        return {
          type: "run_workflow",
          workflowId: "alpha",
          modelSaid: "trust me",
        } as unknown as AgentDecision;
      },
      { modelProfileId: "profile-a" },
    );

    await expect(
      new AgentRuntime({
        registry: new InMemoryAgentRegistry([leaky]),
        availableWorkflows: ["alpha"],
        models,
      }).decide(TASK),
    ).rejects.toThrow(/invalid decision/);
  });
});

// ── 42. Deterministic agents are unaffected ─────────────────────

describe("an agent with no model at all", () => {
  test("decides normally when no models port is installed", async () => {
    const agent = agentDoing(() => Promise.resolve({ type: "run_workflow", workflowId: "alpha" }));

    const result = await new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha"],
      // No `models` option at all.
    }).decide(TASK);

    expect(result.decision.type).toBe("run_workflow");
  });

  test("context.model is still present and safe to call, even so", async () => {
    let reached = false;

    const agent = agentDoing(async (context) => {
      const result = await context.model.generate({
        messages: [{ role: "user", content: "x" }],
        responseSchema: {},
      });
      reached = result.type === "failure";
      return { type: "run_workflow", workflowId: "alpha" };
    });

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha"],
    }).decide(TASK);

    expect(reached).toBe(true);
  });
});
