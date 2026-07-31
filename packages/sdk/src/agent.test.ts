// packages/sdk/src/agent.test.ts
import { describe, expect, test } from "bun:test";
import {
  agentDecisionSchema,
  agentExecutionResultSchema,
  agentManifestSchema,
  agentTaskSchema,
  workerAgentWorkflowMismatch,
} from "./agent";
import { workerManifestSchema } from "./worker-manifest";

/**
 * The agent contracts.
 *
 * These schemas are the boundary the whole layer rests on: an agent's answer
 * is trusted only as far as `agentDecisionSchema` parses it, and an agent's
 * reach is only as wide as `allowedWorkflows` says. Both are tested here for
 * what they refuse as much as for what they accept.
 */

const MANIFEST = {
  id: "test-agent",
  name: "Test Agent",
  description: "Decides things in tests",
  version: "1.0.0",
  instructions: "Answer with a workflow when the request names work.",
  allowedWorkflows: ["alpha"],
};

// ── 1. Manifest validation ──────────────────────────────────────

describe("agentManifestSchema", () => {
  test("accepts a complete manifest", () => {
    const manifest = agentManifestSchema.parse(MANIFEST);

    expect(manifest.id).toBe("test-agent");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.allowedWorkflows).toEqual(["alpha"]);
  });

  test("requires every identifying field", () => {
    for (const field of [
      "id",
      "name",
      "description",
      "version",
      "instructions",
    ] as const) {
      const { [field]: _removed, ...rest } = MANIFEST;
      expect(() => agentManifestSchema.parse(rest)).toThrow();
    }
  });

  test("refuses empty ids and names", () => {
    expect(() => agentManifestSchema.parse({ ...MANIFEST, id: "" })).toThrow();
    expect(() => agentManifestSchema.parse({ ...MANIFEST, name: "" })).toThrow();
  });

  test("requires an explicit version", () => {
    // Not defaulted: a decision recorded without knowing which version of an
    // agent produced it cannot be explained later.
    expect(() =>
      agentManifestSchema.parse({ ...MANIFEST, version: "" }),
    ).toThrow();
  });

  test("requires at least one allowed workflow", () => {
    // An agent permitted to run nothing can only ever decline.
    expect(() =>
      agentManifestSchema.parse({ ...MANIFEST, allowedWorkflows: [] }),
    ).toThrow();
  });

  test("rejects a duplicated workflow id", () => {
    expect(() =>
      agentManifestSchema.parse({
        ...MANIFEST,
        allowedWorkflows: ["alpha", "alpha"],
      }),
    ).toThrow();
  });

  test("is strict, so an unknown key cannot widen what an agent may do", () => {
    expect(() =>
      agentManifestSchema.parse({ ...MANIFEST, allowedWorkflow: "beta" }),
    ).toThrow();
  });

  test("carries optional metadata", () => {
    const manifest = agentManifestSchema.parse({
      ...MANIFEST,
      metadata: { author: "DesignFlow" },
    });

    expect(manifest.metadata).toEqual({ author: "DesignFlow" });
  });
});

// ── 2. Task validation ──────────────────────────────────────────

describe("agentTaskSchema", () => {
  test("accepts a bounded request", () => {
    const task = agentTaskSchema.parse({
      workerId: "worker",
      agentId: "test-agent",
      request: "build the homepage",
    });

    expect(task.workerId).toBe("worker");
    expect(task.input).toBeUndefined();
  });

  test("requires both ids, so a task cannot float free of its worker", () => {
    expect(() =>
      agentTaskSchema.parse({ agentId: "test-agent", request: "x" }),
    ).toThrow();
    expect(() =>
      agentTaskSchema.parse({ workerId: "worker", request: "x" }),
    ).toThrow();
  });

  test("requires the request to be a string", () => {
    expect(() =>
      agentTaskSchema.parse({ workerId: "w", agentId: "a" }),
    ).toThrow();
  });

  test("allows an empty request", () => {
    // Decidable, not malformed: the right answer is a clarifying question, and
    // rejecting it here would turn a conversation into an error.
    expect(
      agentTaskSchema.parse({ workerId: "w", agentId: "a", request: "" })
        .request,
    ).toBe("");
  });

  test("carries arbitrary input and per-request context", () => {
    const task = agentTaskSchema.parse({
      workerId: "w",
      agentId: "a",
      request: "go",
      input: { designFile: "homepage.fig" },
      context: { environment: "local" },
    });

    expect(task.input).toEqual({ designFile: "homepage.fig" });
    expect(task.context).toEqual({ environment: "local" });
  });
});

// ── 3. Decision validation ──────────────────────────────────────

describe("agentDecisionSchema", () => {
  test("accepts each of the three answers", () => {
    expect(
      agentDecisionSchema.parse({ type: "run_workflow", workflowId: "alpha" })
        .type,
    ).toBe("run_workflow");

    expect(
      agentDecisionSchema.parse({
        type: "request_clarification",
        question: "Which design?",
      }).type,
    ).toBe("request_clarification");

    expect(
      agentDecisionSchema.parse({ type: "decline", reason: "Out of scope" })
        .type,
    ).toBe("decline");
  });

  test("rejects an unknown decision type", () => {
    expect(() =>
      agentDecisionSchema.parse({ type: "call_tool", toolId: "shell" }),
    ).toThrow();
  });

  test("requires the field that makes each answer actionable", () => {
    expect(() => agentDecisionSchema.parse({ type: "run_workflow" })).toThrow();
    expect(() =>
      agentDecisionSchema.parse({ type: "request_clarification" }),
    ).toThrow();
    expect(() => agentDecisionSchema.parse({ type: "decline" })).toThrow();

    // Present but empty is the same failure: a blank question asks nothing.
    expect(() =>
      agentDecisionSchema.parse({ type: "request_clarification", question: "" }),
    ).toThrow();
    expect(() =>
      agentDecisionSchema.parse({ type: "decline", reason: "" }),
    ).toThrow();
  });

  test("accepts a user-safe reasoning summary", () => {
    const decision = agentDecisionSchema.parse({
      type: "run_workflow",
      workflowId: "alpha",
      reasoningSummary: "The request describes design work.",
    });

    expect(decision.reasoningSummary).toBe("The request describes design work.");
  });

  test("refuses private reasoning smuggled alongside a valid decision", () => {
    // The whole no-chain-of-thought rule, enforced rather than documented:
    // every member is strict, so reasoning under any other key fails to parse
    // instead of quietly reaching a log, a transcript or a terminal.
    for (const key of ["chainOfThought", "thoughts", "reasoning", "scratchpad"]) {
      expect(() =>
        agentDecisionSchema.parse({
          type: "run_workflow",
          workflowId: "alpha",
          [key]: "step 1: consider the user's true motives",
        }),
      ).toThrow();
    }
  });

  test("keeps run_workflow input optional", () => {
    // An agent that chose only *which* workflow leaves the caller's own input
    // alone rather than replacing it with nothing.
    expect(
      agentDecisionSchema.parse({ type: "run_workflow", workflowId: "alpha" }),
    ).not.toHaveProperty("input");
  });
});

describe("agentExecutionResultSchema", () => {
  test("binds a decision to the agent and worker that produced it", () => {
    const result = agentExecutionResultSchema.parse({
      agentId: "test-agent",
      workerId: "worker",
      decision: { type: "decline", reason: "Nothing to do" },
    });

    expect(result.agentId).toBe("test-agent");
    expect(result.decision.type).toBe("decline");
  });

  test("rejects an invalid decision inside a valid envelope", () => {
    expect(() =>
      agentExecutionResultSchema.parse({
        agentId: "a",
        workerId: "w",
        decision: { type: "run_workflow" },
      }),
    ).toThrow();
  });
});

// ── 4. Worker/agent alignment ───────────────────────────────────

describe("workerAgentWorkflowMismatch", () => {
  const worker = (workflows: readonly string[]) =>
    workerManifestSchema.parse({
      id: "w",
      name: "W",
      description: "d",
      category: "c",
      workflows,
    });

  const agent = agentManifestSchema.parse(MANIFEST);

  test("finds nothing when the worker promises only what the agent may run", () => {
    expect(workerAgentWorkflowMismatch(worker(["alpha"]), agent)).toEqual([]);
  });

  test("names the workflows the agent may not run", () => {
    // A catalogue offering work that will only ever be declined.
    expect(workerAgentWorkflowMismatch(worker(["alpha", "beta"]), agent)).toEqual([
      "beta",
    ]);
  });
});

// ── 5. Worker manifest stays backward compatible ────────────────

describe("workerManifestSchema with agents", () => {
  const base = {
    id: "legacy",
    name: "Legacy",
    description: "Written before agents existed",
    category: "development",
    workflows: ["alpha"],
  };

  test("a worker without an agent still parses", () => {
    expect(workerManifestSchema.parse(base).agentId).toBeUndefined();
  });

  test("a worker may name an agent", () => {
    expect(
      workerManifestSchema.parse({ ...base, agentId: "test-agent" }).agentId,
    ).toBe("test-agent");
  });

  test("an empty agent id is refused rather than treated as absent", () => {
    expect(() => workerManifestSchema.parse({ ...base, agentId: "" })).toThrow();
  });

  test("workflows stay required for an agent-backed worker", () => {
    // What the catalogue advertises, and what the agent's allow-list is
    // checked against. A worker naming only an agent could not be verified.
    const { workflows: _removed, ...withoutWorkflows } = base;

    expect(() =>
      workerManifestSchema.parse({ ...withoutWorkflows, agentId: "test-agent" }),
    ).toThrow();
  });
});
