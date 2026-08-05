// packages/agents/src/decision-prompt.test.ts
import { describe, expect, test } from "bun:test";
import { buildDecisionPrompt, decisionResponseSchema, modelDecisionFromTransport, modelDecisionSchema } from "./decision-prompt";

/**
 * The bounded prompt builder — deterministic, pure, and tested with no model,
 * no provider and no network in sight.
 */

const INPUT = {
  instructions: "Turn a design into working code.",
  request: "build a login page for acme-corp with API_KEY=sk-secret",
  inputSummary: { designFile: "homepage.fig", note: "urgent" },
  availableWorkflows: ["design-to-code"],
  availableTools: ["classify-design-task"],
};

describe("buildDecisionPrompt", () => {
  test("is deterministic: the same input produces the same messages", () => {
    const first = buildDecisionPrompt(INPUT);
    const second = buildDecisionPrompt(INPUT);

    expect(first).toEqual(second);
  });

  test("produces a system and a user message, in that order", () => {
    const { messages } = buildDecisionPrompt(INPUT);

    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
  });

  test("includes the agent's instructions verbatim", () => {
    const { messages } = buildDecisionPrompt(INPUT);
    expect(messages[0]?.content).toContain(INPUT.instructions);
  });

  test("includes the request and the input summary", () => {
    const { messages } = buildDecisionPrompt(INPUT);
    const user = messages[1]?.content ?? "";

    expect(user).toContain(INPUT.request);
    expect(user).toContain("homepage.fig");
    expect(user).toContain("urgent");
  });

  test("lists only the permitted workflows and tools", () => {
    const { messages } = buildDecisionPrompt(INPUT);
    const system = messages[0]?.content ?? "";

    expect(system).toContain("design-to-code");
    expect(system).toContain("classify-design-task");
  });

  test("asks for a reasoningSummary and explicitly not chain-of-thought", () => {
    const { messages } = buildDecisionPrompt(INPUT);
    const system = messages[0]?.content ?? "";

    expect(system.toLowerCase()).toContain("reasoningsummary");
    expect(system.toLowerCase()).not.toContain("step by step");
    expect(system.toLowerCase()).not.toContain("chain of thought");
  });

  test("prohibits capabilities and shell commands without naming a concrete one", () => {
    // The system message legitimately tells the model it may *not* choose a
    // capability or a shell command — that prohibition has to say the words.
    // What must never appear is a concrete identifier: an actual capability
    // id, an actual command, a real repository path.
    const { messages } = buildDecisionPrompt(INPUT);
    const system = messages[0]?.content ?? "";

    expect(system.toLowerCase()).toContain("you may not name");
    for (const concrete of ["rm -rf", "artifactstore.", "repository.get", "/bin/sh"]) {
      expect(system).not.toContain(concrete);
    }
  });

  test("carries no infrastructure fact DesignFlow itself holds", () => {
    // Never an execution id, a host path, or any fact about how DesignFlow
    // stores or runs things — none of which the prompt builder is even given
    // access to. This is distinct from what the *user's own request* says:
    // a request is echoed verbatim, on purpose, and is covered separately.
    const { messages } = buildDecisionPrompt(INPUT);
    const whole = messages.map((message) => message.content).join("\n");

    for (const forbidden of ["executionid", "/users/", "designflow_home", "traceid"]) {
      expect(whole.toLowerCase()).not.toContain(forbidden);
    }
  });

  test("the user's request is echoed as-is, including whatever the user wrote", () => {
    // Bounded means "only what the agent needs," not "sanitised of the
    // user's own words." A request containing something credential-shaped is
    // the user's own data — DesignFlow never invented it and is not the one
    // leaking it — and the model needs to see the actual request to decide
    // about it.
    const { messages } = buildDecisionPrompt(INPUT);
    expect(messages[1]?.content).toContain(INPUT.request);
  });

  test("bounds the input summary to a fixed number of fields", () => {
    const many = Object.fromEntries(
      Array.from({ length: 100 }, (_unused, index) => [`field${index}`, `value${index}`]),
    );

    const { messages } = buildDecisionPrompt({ ...INPUT, inputSummary: many });
    const user = messages[1]?.content ?? "";

    // Not every one of the hundred fields can have made it in.
    expect(user).not.toContain("field99");
  });

  test("truncates an oversized single value rather than including it whole", () => {
    const { messages } = buildDecisionPrompt({
      ...INPUT,
      inputSummary: { note: "x".repeat(5_000) },
    });
    const user = messages[1]?.content ?? "";

    expect(user.length).toBeLessThan(5_000);
  });

  test("handles no input summary and an empty request without throwing", () => {
    expect(() =>
      buildDecisionPrompt({ ...INPUT, request: "", inputSummary: undefined }),
    ).not.toThrow();
  });

  test("produces a flat response schema without top-level oneOf", () => {
    const { responseSchema } = buildDecisionPrompt(INPUT);

    expect(responseSchema["oneOf"]).toBeUndefined();
    expect(responseSchema["required"]).toEqual(["type", "workflowId", "question", "reason", "reasoningSummary"]);
    expect(responseSchema["additionalProperties"]).toBe(false);
  });

  test("the response schema constrains workflowId to the permitted list", () => {
    const schema = decisionResponseSchema(["design-to-code", "other-workflow"]);
    const properties = schema["properties"] as Record<string, unknown>;
    const workflowIdSchema = properties["workflowId"] as { enum?: readonly unknown[] };

    expect(workflowIdSchema.enum).toEqual(["design-to-code", "other-workflow", null]);
  });
});

describe("modelDecisionFromTransport", () => {
  test("converts valid workflow, clarification, and decline transports", () => {
    expect(modelDecisionFromTransport({ type: "run_workflow", workflowId: "design-to-code", question: null, reason: null, reasoningSummary: "build it" }, ["design-to-code"]))
      .toEqual({ type: "run_workflow", workflowId: "design-to-code", reasoningSummary: "build it" });
    expect(modelDecisionFromTransport({ type: "request_clarification", workflowId: null, question: "Which frame?", reason: null, reasoningSummary: "need detail" }, ["design-to-code"]))
      .toEqual({ type: "request_clarification", question: "Which frame?", reasoningSummary: "need detail" });
    expect(modelDecisionFromTransport({ type: "decline", workflowId: null, question: null, reason: "not supported", reasoningSummary: "out of scope" }, ["design-to-code"]))
      .toEqual({ type: "decline", reason: "not supported", reasoningSummary: "out of scope" });
  });

  test("rejects invalid conditional fields, unknown workflows, and extra properties", () => {
    expect(modelDecisionFromTransport({ type: "run_workflow", workflowId: "unknown", question: null, reason: null, reasoningSummary: "x" }, ["design-to-code"])).toBeUndefined();
    expect(modelDecisionFromTransport({ type: "run_workflow", workflowId: "design-to-code", question: "also", reason: null, reasoningSummary: "x" }, ["design-to-code"])).toBeUndefined();
    expect(modelDecisionFromTransport({ type: "decline", workflowId: null, question: null, reason: "x", reasoningSummary: "x", extra: true }, ["design-to-code"])).toBeUndefined();
    expect(modelDecisionFromTransport({ type: "request_clarification", workflowId: null, question: " ", reason: null, reasoningSummary: "x" }, ["design-to-code"])).toBeUndefined();
  });
});

// ── The model-facing decision schema ─────────────────────────────

describe("modelDecisionSchema", () => {
  test("accepts each of the three decisions", () => {
    expect(
      modelDecisionSchema.parse({
        type: "run_workflow",
        workflowId: "design-to-code",
        reasoningSummary: "matches",
      }).type,
    ).toBe("run_workflow");

    expect(
      modelDecisionSchema.parse({
        type: "request_clarification",
        question: "which design?",
        reasoningSummary: "unclear",
      }).type,
    ).toBe("request_clarification");

    expect(
      modelDecisionSchema.parse({
        type: "decline",
        reason: "out of scope",
        reasoningSummary: "no match",
      }).type,
    ).toBe("decline");
  });

  test("has no field for workflow input", () => {
    // The model chooses which workflow, never what to run it with — see the
    // module docstring for why.
    expect(() =>
      modelDecisionSchema.parse({
        type: "run_workflow",
        workflowId: "design-to-code",
        reasoningSummary: "ok",
        input: { designFile: "injected.fig" },
      }),
    ).toThrow();
  });

  test("refuses chain-of-thought smuggled under any key", () => {
    for (const key of ["chainOfThought", "reasoning", "thoughts", "scratchpad"]) {
      expect(() =>
        modelDecisionSchema.parse({
          type: "run_workflow",
          workflowId: "design-to-code",
          reasoningSummary: "ok",
          [key]: "first I considered...",
        }),
      ).toThrow();
    }
  });

  test("bounds reasoningSummary length", () => {
    expect(() =>
      modelDecisionSchema.parse({
        type: "decline",
        reason: "x",
        reasoningSummary: "y".repeat(1_000),
      }),
    ).toThrow();
  });

  test("rejects an unknown decision type", () => {
    expect(() =>
      modelDecisionSchema.parse({ type: "call_tool", toolId: "shell" }),
    ).toThrow();
  });
});

// ── Resumed clarifications ────────────────────────────────────────

describe("buildDecisionPrompt with clarifications", () => {
  test("a fresh decision (no clarifications) is byte-identical to before this existed", () => {
    const withEmpty = buildDecisionPrompt({ ...INPUT, clarifications: [] });
    const withUndefined = buildDecisionPrompt(INPUT);

    expect(withEmpty).toEqual(withUndefined);
  });

  test("a resumed decision's prompt actually carries the prior exchange", () => {
    const { messages } = buildDecisionPrompt({
      ...INPUT,
      clarifications: [{ question: "Which component?", answer: "the header" }],
    });

    const user = messages[1]?.content ?? "";
    expect(user).toContain("Which component?");
    expect(user).toContain("the header");
  });

  test("two decisions differing only by clarifications produce different prompts", () => {
    const first = buildDecisionPrompt(INPUT);
    const second = buildDecisionPrompt({
      ...INPUT,
      clarifications: [{ question: "Which component?", answer: "the header" }],
    });

    expect(first).not.toEqual(second);
  });

  test("bounds the number of clarifications rendered", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      question: `q${i}`,
      answer: `a${i}`,
    }));

    const { messages } = buildDecisionPrompt({ ...INPUT, clarifications: many });
    const user = messages[1]?.content ?? "";

    expect(user).toContain("q0");
    expect(user).not.toContain("q49");
  });
});

describe("buildDecisionPrompt with project facts and memory", () => {
  test("absent projectFacts/memoryNotes is byte-identical to before Stage 40", () => {
    const withEmpty = buildDecisionPrompt({ ...INPUT, projectFacts: [], memoryNotes: [] });
    const withUndefined = buildDecisionPrompt(INPUT);

    expect(withEmpty).toEqual(withUndefined);
  });

  test("project facts and memory notes appear in the user message", () => {
    const { messages } = buildDecisionPrompt({
      ...INPUT,
      projectFacts: [{ key: "project.framework", value: "react" }],
      memoryNotes: [{ key: "prefer.existingComponents", value: true }],
    });

    const user = messages[1]?.content ?? "";
    expect(user).toContain("project.framework");
    expect(user).toContain("react");
    expect(user).toContain("prefer.existingComponents");
  });

  test("bounds the number of facts rendered", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ key: `project.fact${i}`, value: i }));

    const { messages } = buildDecisionPrompt({ ...INPUT, projectFacts: many });
    const user = messages[1]?.content ?? "";

    expect(user).toContain("project.fact0");
    expect(user).not.toContain("project.fact49");
  });
});
