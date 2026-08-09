// packages/agents/src/runtime.test.ts
import { describe, expect, test } from "bun:test";
import {
  DesignFlowError,
  type Agent,
  type AgentContext,
  type AgentDecision,
  type AgentManifest,
  type AgentTask,
} from "@designflow/sdk";

import { InMemoryAgentRegistry } from "./registry";
import { AgentRuntime } from "./runtime";
import { createAgentRegistry } from "./index";

/**
 * The decision boundary.
 *
 * Every test here is about what the runtime refuses. An agent's answer is
 * trusted only after it has been parsed and checked against two allow-lists,
 * and the point of the layer is that a wrong — or manipulated — answer stops
 * here rather than reaching the engine.
 */

const MANIFEST: AgentManifest = {
  id: "test-agent",
  name: "Test Agent",
  description: "Decides things in tests",
  version: "1.0.0",
  instructions: "Run alpha.",
  allowedWorkflows: ["alpha", "beta"],
};

/** An agent that answers with whatever the test tells it to. */
function scripted(
  decision: unknown,
  overrides: Partial<AgentManifest> = {},
): Agent {
  return {
    manifest: { ...MANIFEST, ...overrides },
    // Cast at the seam a real agent's model output will cross: the runtime's
    // job is to validate an untrusted answer, so a test must be able to
    // produce one that does not typecheck as a decision.
    decide: (): Promise<AgentDecision> =>
      Promise.resolve(decision as AgentDecision),
  };
}

function runtimeFor(
  agent: Agent,
  availableWorkflows: readonly string[] = ["alpha", "beta"],
): AgentRuntime {
  return new AgentRuntime({
    registry: new InMemoryAgentRegistry([agent]),
    availableWorkflows,
  });
}

const TASK: AgentTask = {
  workerId: "test-worker",
  agentId: "test-agent",
  request: "the homepage from this design",
};

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(DesignFlowError);
    return (error as DesignFlowError).code;
  }

  throw new Error("expected the runtime to refuse");
}

// ── Task validation ─────────────────────────────────────────────

describe("validating the task", () => {
  test("refuses a malformed task before consulting the agent", async () => {
    let consulted = false;

    const agent: Agent = {
      manifest: MANIFEST,
      decide: (): Promise<AgentDecision> => {
        consulted = true;
        return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
      },
    };

    const code = await codeOf(() =>
      runtimeFor(agent).decide({ ...TASK, workerId: "" }),
    );

    expect(code).toBe("ERR_AGENT_TASK_INVALID");
    // A malformed task cannot produce a meaningful decision, and consulting an
    // agent with one would only move the failure somewhere harder to read.
    expect(consulted).toBe(false);
  });

  test("names the offending field", async () => {
    const runtime = runtimeFor(
      scripted({ type: "run_workflow", workflowId: "alpha" }),
    );

    try {
      await runtime.decide({ ...TASK, request: 42 } as unknown as AgentTask);
      throw new Error("expected the runtime to refuse");
    } catch (error) {
      expect((error as DesignFlowError).metadata.issues).toEqual([
        expect.stringContaining("request"),
      ]);
    }
  });

  test("an empty request reaches the agent rather than being refused", async () => {
    // Decidable, not malformed. The agent answers with a question.
    const result = await runtimeFor(
      scripted({ type: "request_clarification", question: "Which design?" }),
    ).decide({ ...TASK, request: "" });

    expect(result.decision.type).toBe("request_clarification");
  });
});

// ── Agent resolution ────────────────────────────────────────────

describe("resolving the agent", () => {
  test("refuses a task naming an agent that is not installed", async () => {
    const runtime = runtimeFor(
      scripted({ type: "run_workflow", workflowId: "alpha" }),
    );

    expect(await codeOf(() => runtime.decide({ ...TASK, agentId: "ghost" }))).toBe(
      "ERR_AGENT_NOT_FOUND",
    );
  });
});

// ── The restricted context ──────────────────────────────────────

describe("the context an agent decides with", () => {
  test("offers only workflows that are both permitted and installed", async () => {
    let seen: readonly string[] = [];

    const agent: Agent = {
      manifest: MANIFEST,
      decide: (_task: AgentTask, context: AgentContext): Promise<AgentDecision> => {
        seen = context.availableWorkflows;
        return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
      },
    };

    // `beta` is permitted but not installed; `gamma` is installed but not
    // permitted. Neither is choosable.
    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha", "gamma"],
    }).decide(TASK);

    expect(seen).toEqual(["alpha"]);
  });

  test("carries a signal and ambient metadata, and no infrastructure", async () => {
    let seen: AgentContext | null = null;

    const agent: Agent = {
      manifest: MANIFEST,
      decide: (_task: AgentTask, context: AgentContext): Promise<AgentDecision> => {
        seen = context;
        return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
      },
    };

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha"],
      metadata: { environment: "test" },
    }).decide(TASK);

    const context = seen as AgentContext | null;
    expect(context?.metadata).toEqual({ environment: "test" });
    expect(context?.signal.aborted).toBe(false);

    // An agent that could reach a repository or an artifact store could act
    // instead of decide, and the boundary would exist only in the docs. The
    // tool port is the one addition, and it is a service with a single verb —
    // never the registry or the runtime behind it.
    expect(Object.keys(context ?? {}).sort()).toEqual([
      "availableTools",
      "availableWorkflows",
      "logger",
      "metadata",
      "model",
      "reportCoordinatorOutputFailure",
      "signal",
      "tools",
    ]);
    expect(Object.keys(context?.tools ?? {})).toEqual(["call"]);
    // The model port is the Stage 38 addition, and it is a service with a
    // single verb — never the registry or the runtime behind it.
    expect(Object.keys(context?.model ?? {})).toEqual(["generate"]);
  });

  test("passes the caller's signal through", async () => {
    let aborted: boolean | null = null;

    const agent: Agent = {
      manifest: MANIFEST,
      decide: (_task: AgentTask, context: AgentContext): Promise<AgentDecision> => {
        aborted = context.signal.aborted;
        return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
      },
    };

    const controller = new AbortController();
    controller.abort();

    await new AgentRuntime({
      registry: new InMemoryAgentRegistry([agent]),
      availableWorkflows: ["alpha"],
    }).decide(TASK, controller.signal);

    expect(aborted).toBe(true);
  });
});

// ── Decision validation ─────────────────────────────────────────

describe("validating the decision", () => {
  test("accepts a well-formed run_workflow", async () => {
    const result = await runtimeFor(
      scripted({
        type: "run_workflow",
        workflowId: "alpha",
        input: { designFile: "homepage.fig" },
        reasoningSummary: "The request describes design work.",
      }),
    ).decide(TASK);

    expect(result.decision).toEqual({
      type: "run_workflow",
      workflowId: "alpha",
      input: { designFile: "homepage.fig" },
      reasoningSummary: "The request describes design work.",
    });
    expect(result.agentId).toBe("test-agent");
    expect(result.workerId).toBe("test-worker");
  });

  test("refuses an unknown decision type", async () => {
    const code = await codeOf(() =>
      runtimeFor(scripted({ type: "call_tool", toolId: "shell" })).decide(TASK),
    );

    expect(code).toBe("ERR_AGENT_DECISION_INVALID");
  });

  test("refuses a decision missing the field that makes it actionable", async () => {
    expect(
      await codeOf(() => runtimeFor(scripted({ type: "run_workflow" })).decide(TASK)),
    ).toBe("ERR_AGENT_DECISION_INVALID");
  });

  test("refuses a decision carrying private reasoning", async () => {
    // Strict members mean chain-of-thought fails to parse rather than being
    // quietly carried into a result a caller might log or print.
    const code = await codeOf(() =>
      runtimeFor(
        scripted({
          type: "run_workflow",
          workflowId: "alpha",
          chainOfThought: "step 1: consider the user's true motives",
        }),
      ).decide(TASK),
    );

    expect(code).toBe("ERR_AGENT_DECISION_INVALID");
  });

  test("a returned result never carries a key the schema does not name", async () => {
    const result = await runtimeFor(
      scripted({
        type: "run_workflow",
        workflowId: "alpha",
        reasoningSummary: "Design work.",
      }),
    ).decide(TASK);

    // `traceId` joined the result in Stage 37. It is always present, tracer or
    // not: the id identifies the decision, and whether anyone recorded it is a
    // separate question from whether it happened.
    expect(Object.keys(result).sort()).toEqual([
      "agentId",
      "decision",
      "traceId",
      "workerId",
    ]);
    expect(result.traceId).toMatch(/\S/);
    expect(Object.keys(result.decision).sort()).toEqual([
      "reasoningSummary",
      "type",
      "workflowId",
    ]);
  });
});

// ── Workflow enforcement ────────────────────────────────────────

describe("enforcing the allow-list", () => {
  test("refuses a workflow outside the agent's manifest", async () => {
    // The core safety property: an agent cannot reach a workflow it did not
    // declare, however it arrived at the answer.
    const code = await codeOf(() =>
      runtimeFor(
        scripted({ type: "run_workflow", workflowId: "gamma" }),
        ["alpha", "beta", "gamma"],
      ).decide(TASK),
    );

    expect(code).toBe("ERR_AGENT_WORKFLOW_NOT_ALLOWED");
  });

  test("the refusal reports what the agent was permitted", async () => {
    try {
      await runtimeFor(
        scripted({ type: "run_workflow", workflowId: "gamma" }),
        ["gamma"],
      ).decide(TASK);
      throw new Error("expected the runtime to refuse");
    } catch (error) {
      expect((error as DesignFlowError).metadata.allowedWorkflows).toEqual([
        "alpha",
        "beta",
      ]);
    }
  });

  test("refuses a permitted workflow this installation does not have", async () => {
    // A separate code from the one above: "not permitted" is a trust problem,
    // "not installed" is a deployment problem, and one code for both would
    // make the first invisible inside the second.
    const code = await codeOf(() =>
      runtimeFor(scripted({ type: "run_workflow", workflowId: "beta" }), [
        "alpha",
      ]).decide(TASK),
    );

    expect(code).toBe("ERR_AGENT_WORKFLOW_UNAVAILABLE");
  });

  test("enforcement does not depend on the agent reading the context", async () => {
    // The narrowed `availableWorkflows` is a convenience for a well-behaved
    // agent. An agent that ignores it is still stopped.
    const agent: Agent = {
      manifest: MANIFEST,
      decide: (): Promise<AgentDecision> =>
        Promise.resolve({ type: "run_workflow", workflowId: "beta" }),
    };

    expect(
      await codeOf(() =>
        new AgentRuntime({
          registry: new InMemoryAgentRegistry([agent]),
          availableWorkflows: ["alpha"],
        }).decide(TASK),
      ),
    ).toBe("ERR_AGENT_WORKFLOW_UNAVAILABLE");
  });

  test("clarification and decline are not workflow-checked", async () => {
    // Neither names a workflow, so neither can reach one.
    const asking = await runtimeFor(
      scripted({ type: "request_clarification", question: "Which design?" }),
      [],
    ).decide(TASK);

    const declining = await runtimeFor(
      scripted({ type: "decline", reason: "Out of scope" }),
      [],
    ).decide(TASK);

    expect(asking.decision).toEqual({
      type: "request_clarification",
      question: "Which design?",
    });
    expect(declining.decision).toEqual({
      type: "decline",
      reason: "Out of scope",
    });
  });
});

// ── The runtime is not an execution engine ──────────────────────

describe("what the runtime does not do", () => {
  test("consults the agent exactly once", async () => {
    let calls = 0;

    const agent: Agent = {
      manifest: MANIFEST,
      decide: (): Promise<AgentDecision> => {
        calls += 1;
        return Promise.resolve({ type: "run_workflow", workflowId: "alpha" });
      },
    };

    await runtimeFor(agent).decide(TASK);

    // One task in, one decision out. An agent that could re-enter its own
    // decision would be scheduling work, which is the engine's job.
    expect(calls).toBe(1);
  });

  test("returns a decision rather than a result of running anything", async () => {
    const result = await runtimeFor(
      scripted({ type: "run_workflow", workflowId: "alpha" }),
    ).decide(TASK);

    // Nothing here names an execution: no executionId, no artifacts, no state.
    expect(result).not.toHaveProperty("executionId");
    expect(result).not.toHaveProperty("artifacts");
    expect(result.decision.type).toBe("run_workflow");
  });
});

// ── The shipped agent ───────────────────────────────────────────

describe("the Design Engineer agent", () => {
  // MVP-3B: routing only serves the supported journeys. A real Figma source
  // selects the specification workflow; without one, the agent clarifies
  // with setup guidance instead of falling back to the legacy scaffold.
  const runtime = new AgentRuntime({
    registry: createAgentRegistry(),
    availableWorkflows: ["design-to-code", "design-to-code-figma-specification"],
  });

  const task = (overrides: Partial<AgentTask> = {}): AgentTask => ({
    workerId: "design-engineer",
    agentId: "design-engineer-agent",
    request: "the homepage from this design",
    input: { figmaSourceMode: "mcp-stdio" },
    ...overrides,
  });

  test("resolves a real request to the design-specification journey", async () => {
    const result = await runtime.decide(task());

    expect(result.decision).toEqual({
      type: "run_workflow",
      workflowId: "design-to-code-figma-specification",
      input: { figmaSourceMode: "mcp-stdio" },
      reasoningSummary: expect.any(String),
    });
  });

  test("passes the caller's input through", async () => {
    const result = await runtime.decide(
      task({ request: "", input: { designFile: "homepage.fig", figmaSourceMode: "mcp-stdio" } }),
    );

    expect(result.decision).toMatchObject({
      type: "run_workflow",
      input: { designFile: "homepage.fig", figmaSourceMode: "mcp-stdio" },
    });
  });

  test("never selects the legacy scaffold for a normal request", async () => {
    // Only the legacy workflow installed: the canonical journey clarifies
    // with setup guidance rather than running the compatibility-only
    // prototype.
    const result = await new AgentRuntime({
      registry: createAgentRegistry(),
      availableWorkflows: ["design-to-code"],
    }).decide(task({ input: undefined }));

    expect(result.decision.type).toBe("request_clarification");
  });

  test("asks for detail when there is nothing to work from", async () => {
    const result = await runtime.decide(task({ request: "   ", input: undefined }));

    expect(result.decision.type).toBe("request_clarification");
  });

  test("treats an empty form as nothing to work from", async () => {
    const result = await runtime.decide(task({ request: "", input: {} }));

    expect(result.decision.type).toBe("request_clarification");
  });

  test("clarifies when no supported workflow is installed", async () => {
    const result = await new AgentRuntime({
      registry: createAgentRegistry(),
      availableWorkflows: [],
    }).decide(task());

    // Asking with setup guidance rather than throwing keeps a misconfigured
    // install steering the user instead of failing from under the runtime.
    expect(result.decision.type).toBe("request_clarification");
  });

  test("its summary explains without exposing reasoning", async () => {
    const result = await runtime.decide(task());

    if (result.decision.type !== "run_workflow") {
      throw new Error("expected a run_workflow decision");
    }

    expect(result.decision.reasoningSummary).toBe(
      "A real Figma source is connected, so the design-specification journey will be used.",
    );
  });
});
