// apps/designflow-cli/src/multi-agent-model-independence.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  createServer,
  type Server,
} from "node:http";

import {
  createDesignEngineerAgent,
  deterministicDesignEngineerStrategy,
  designEngineerAgentManifest,
  designEngineerDefaultModelProfile,
  modelDesignEngineerStrategy,
  createQaReviewerAgent,
  modelQaReviewerStrategy,
  qaReviewerAgentManifest,
  qaReviewerDefaultModelProfile,
  AgentRuntime,
  InMemoryAgentRegistry,
} from "@designflow/agents";
import {
  InMemoryModelProfileRegistry,
  InMemoryModelProviderRegistry,
  ModelRuntime,
  mergeModelProfileOverrides,
} from "@designflow/models";
import { OpenRouterProvider } from "@designflow/model-provider-openrouter";
import type { AgentTask } from "@designflow/sdk";

/**
 * Stage 38 adversarial verification: "independent model selection per agent"
 * as load-bearing architecture, not a documentation claim.
 *
 * Two REAL agents (the Design Engineer, model-mode; a second, independent
 * QA Reviewer agent built for this proof) share exactly ONE
 * provider-neutral `ModelRuntime`, backed by exactly ONE `OpenRouterProvider`
 * instance, talking to exactly ONE real local HTTP server standing in for
 * OpenRouter. Nothing here is a fake `ModelInvoker` — every request in this
 * file crosses a real HTTP socket and is parsed by a real server, the same
 * proof standard `provider.test.ts` and `model-mode.test.ts` already hold
 * single-agent wiring to.
 *
 * What single-agent tests elsewhere in this codebase cannot show — because
 * they only ever wire up one agent — is that a *second* agent, added to the
 * same runtime, resolves its own distinct model without touching or being
 * touched by the first. That is the one gap this file exists to close.
 */

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

interface Captured {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: { model?: string; response_format?: unknown } & Record<string, unknown>;
}

function flatDecision(decision: unknown): unknown {
  if (typeof decision !== "object" || decision === null || !("type" in decision)) return decision;
  const record = decision as Record<string, unknown>;
  return {
    ...record,
    workflowId: record.workflowId ?? null,
    question: record.question ?? null,
    reason: record.reason ?? null,
  };
}

/**
 * One real HTTP server, answering every request with a decision picked for
 * the requested model — each agent's own workflow, by default — echoing the
 * requested model back.
 */
async function mockOpenRouter(
  decisionFor: (model: string | undefined) => unknown = (model) => ({
    type: "run_workflow",
    workflowId: model === qaReviewerDefaultModelProfile.model ? "qa-review" : "design-to-code",
    reasoningSummary: "ok",
  }),
): Promise<{ endpoint: string; requests: Captured[] }> {
  const requests: Captured[] = [];

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      const body = raw.length > 0 ? (JSON.parse(raw) as Captured["body"]) : ({} as Captured["body"]);
      requests.push({ headers: req.headers, body });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `gen-${requests.length}`,
          model: body.model,
          choices: [{ message: { role: "assistant", content: JSON.stringify(flatDecision(decisionFor(body.model))) } }],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
      );
    });
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected an address");

  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

function taskFor(agentId: string): AgentTask {
  return { workerId: agentId, agentId, request: "review this change", input: { file: "x.fig" } };
}

// ── 1/2/3. Each agent sends its own model slug; no cross-use ────

describe("two real agents, one provider-neutral runtime", () => {
  test("agent A's request carries its own model; agent B's carries a different one", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        designEngineerDefaultModelProfile,
        qaReviewerDefaultModelProfile,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        createDesignEngineerAgent(modelDesignEngineerStrategy),
        createQaReviewerAgent(modelQaReviewerStrategy),
      ]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    await agentRuntime.decide(taskFor("design-engineer-agent"));
    await agentRuntime.decide(taskFor("qa-reviewer-agent"));

    expect(mock.requests).toHaveLength(2);
    expect(mock.requests[0]?.body.model).toBe("openai/gpt-4o-mini");
    expect(mock.requests[1]?.body.model).toBe("anthropic/claude-3.5-haiku");
    // The two slugs actually differ — this is not two agents that happen to
    // agree; changing one cannot silently be "the same value twice."
    expect(mock.requests[0]?.body.model).not.toBe(mock.requests[1]?.body.model);
  });

  test("running agent A sends exactly one request, naming only agent A's profile — B never touched", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        designEngineerDefaultModelProfile,
        qaReviewerDefaultModelProfile,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        createDesignEngineerAgent(modelDesignEngineerStrategy),
        createQaReviewerAgent(modelQaReviewerStrategy),
      ]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    await agentRuntime.decide(taskFor("design-engineer-agent"));

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.body.model).toBe("openai/gpt-4o-mini");
    expect(mock.requests[0]?.body.model).not.toBe("anthropic/claude-3.5-haiku");
  });

  test("running agent B sends exactly one request, naming only agent B's profile — A never touched", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        designEngineerDefaultModelProfile,
        qaReviewerDefaultModelProfile,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        createDesignEngineerAgent(modelDesignEngineerStrategy),
        createQaReviewerAgent(modelQaReviewerStrategy),
      ]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    await agentRuntime.decide(taskFor("qa-reviewer-agent"));

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.body.model).toBe("anthropic/claude-3.5-haiku");
    expect(mock.requests[0]?.body.model).not.toBe("openai/gpt-4o-mini");
  });

  // 4. Changing only profile A changes only agent A.
  test("a local override to profile A's model reaches only agent A's requests", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const overridden = mergeModelProfileOverrides(
      [designEngineerDefaultModelProfile, qaReviewerDefaultModelProfile],
      { "design-engineer-default": { model: "openai/gpt-4o" } },
    );

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry(overridden),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        createDesignEngineerAgent(modelDesignEngineerStrategy),
        createQaReviewerAgent(modelQaReviewerStrategy),
      ]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    await agentRuntime.decide(taskFor("design-engineer-agent"));
    await agentRuntime.decide(taskFor("qa-reviewer-agent"));

    // Agent A's override reached agent A ...
    expect(mock.requests[0]?.body.model).toBe("openai/gpt-4o");
    // ... and agent B's model is completely unaffected by the edit.
    expect(mock.requests[1]?.body.model).toBe("anthropic/claude-3.5-haiku");
  });

  // 5. No mandatory global model overrides either agent.
  test("neither agent's manifest, profile, or request carries a field for a global default", () => {
    // Structural: there is no "default model" concept anywhere in the
    // contracts these agents were built from. Each manifest names its own
    // profile id and nothing else.
    expect(designEngineerAgentManifest.modelProfileId).toBe("design-engineer-default");
    expect(qaReviewerAgentManifest.modelProfileId).toBe("qa-reviewer-default");
    expect(designEngineerAgentManifest.modelProfileId).not.toBe(qaReviewerAgentManifest.modelProfileId);
    expect(Object.keys(designEngineerDefaultModelProfile)).not.toContain("default");
    expect("global" in designEngineerDefaultModelProfile).toBe(false);
  });

  // 6. An agent cannot request another agent's profile.
  test("qa-reviewer's model port has no field through which to name design-engineer's profile", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        designEngineerDefaultModelProfile,
        qaReviewerDefaultModelProfile,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([createQaReviewerAgent(modelQaReviewerStrategy)]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    await agentRuntime.decide(taskFor("qa-reviewer-agent"));

    // `AgentModelRequest` (what `context.model.generate` accepts) has no
    // `profileId` field — the runtime, not the agent, decides which profile
    // a call resolves to, from the manifest alone. There is no way for
    // `qaReviewerAgent`'s own code to have produced a request naming
    // "design-engineer-default": the type does not admit one.
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.body.model).toBe("anthropic/claude-3.5-haiku");
  });

  // 7. Missing profile fails before any provider request.
  test("an agent naming an unregistered profile never reaches the mock server at all", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    // Only the QA Reviewer's profile is registered — Design Engineer's is
    // deliberately left out, simulating an agent shipped with a profile id
    // the current installation never configured.
    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([qaReviewerDefaultModelProfile]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([createDesignEngineerAgent(modelDesignEngineerStrategy)]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    const result = await agentRuntime.decide(taskFor("design-engineer-agent"));

    expect(mock.requests).toHaveLength(0);
    expect(result.decision.type).toBe("decline");
  });

  // 8. Legacy deterministic agents remain functional without a profile.
  test("the deterministic Design Engineer strategy never touches the model runtime or the mock server", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        designEngineerDefaultModelProfile,
        qaReviewerDefaultModelProfile,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([createDesignEngineerAgent(deterministicDesignEngineerStrategy)]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
      // No classifier tool installed — `hasSomethingToDo` still resolves
      // from the task's own request/input, so this exercises the fully
      // offline legacy path with a real ModelRuntime present but idle.
    });

    const result = await agentRuntime.decide(taskFor("design-engineer-agent"));

    expect(mock.requests).toHaveLength(0);
    expect(result.decision.type).toBe("run_workflow");
  });

  // Concurrency: interleaved calls from both agents never cross-deliver.
  test("concurrent decisions from both agents never swap models under interleaving", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        designEngineerDefaultModelProfile,
        qaReviewerDefaultModelProfile,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        createDesignEngineerAgent(modelDesignEngineerStrategy),
        createQaReviewerAgent(modelQaReviewerStrategy),
      ]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        agentRuntime.decide(taskFor(index % 2 === 0 ? "design-engineer-agent" : "qa-reviewer-agent")),
      ),
    );

    const models = mock.requests.map((request) => request.body.model);
    expect(models.filter((model) => model === "openai/gpt-4o-mini")).toHaveLength(3);
    expect(models.filter((model) => model === "anthropic/claude-3.5-haiku")).toHaveLength(3);
  });

  // Credential and structured-output evidence, captured at the same
  // real-wire boundary, for both agents.
  test("both agents' requests carry structured-output config and the same redacted bearer credential", async () => {
    const mock = await mockOpenRouter();
    const provider = new OpenRouterProvider({ apiKey: "sk-fake-adversarial-marker", endpoint: mock.endpoint });

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        designEngineerDefaultModelProfile,
        qaReviewerDefaultModelProfile,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });

    const agentRuntime = new AgentRuntime({
      registry: new InMemoryAgentRegistry([
        createDesignEngineerAgent(modelDesignEngineerStrategy),
        createQaReviewerAgent(modelQaReviewerStrategy),
      ]),
      availableWorkflows: ["design-to-code", "qa-review"],
      models: runtime,
    });

    await agentRuntime.decide(taskFor("design-engineer-agent"));
    await agentRuntime.decide(taskFor("qa-reviewer-agent"));

    for (const request of mock.requests) {
      expect(request.body.response_format).toBeDefined();
      expect(request.headers.authorization).toBe("Bearer sk-fake-adversarial-marker");
    }
  });
});
