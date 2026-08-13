// packages/agents/src/catalog/design-engineer-agent.test.ts
import { describe, expect, test } from "bun:test";
import type {
  AgentTask,
  ModelInvocationRequest,
  ModelInvoker,
  ToolCall,
  ToolInvoker,
  ToolResult,
} from "@designflow/sdk";
import { InMemoryAgentRegistry } from "../../registry";
import { AgentRuntime } from "../../runtime";
import {
  createDesignEngineerAgent,
  deterministicDesignEngineerStrategy,
  designEngineerAgent,
  modelDesignEngineerStrategy,
} from "../design-engineer-agent";

/**
 * The MVP-3B routing contract, exercised through the real `AgentRuntime`.
 *
 * The Design Engineer routes only to the supported journeys: the
 * specification workflow when a real Figma source is present, the
 * implementation workflow when a project AND explicit journey consent are
 * present, and an actionable clarification otherwise. The legacy
 * `design-to-code` scaffold is compatibility-only and is never selected;
 * the model strategy consults no model for routing — deterministic
 * prerequisites fully determine the permitted outcome.
 */

const SUPPORTED = [
  "design-to-code",
  "design-to-code-figma-specification",
  "design-to-code-implementation",
] as const;

const TASK: AgentTask = {
  workerId: "design-engineer",
  agentId: "design-engineer-agent",
  request: "a login page from this design",
  input: { designFile: "homepage.fig", figmaSourceMode: "mcp-stdio" },
};

function classifierTool(taskType: string): ToolInvoker & { readonly seen: ToolCall[] } {
  const seen: ToolCall[] = [];

  return {
    seen,
    installedToolIds: () => ["classify-design-task"],
    invoke: (request) => {
      seen.push(request.call);
      const result: ToolResult = {
        type: "success",
        callId: request.call.id,
        toolId: request.call.toolId,
        output: { taskType, confidence: 0.8, signals: [] },
        durationMs: 1,
      };
      return Promise.resolve(result);
    },
  };
}

function runtimeWith(options: {
  tools?: ToolInvoker;
  models?: ModelInvoker;
  strategy: typeof deterministicDesignEngineerStrategy;
  availableWorkflows?: readonly string[];
}): AgentRuntime {
  return new AgentRuntime({
    registry: new InMemoryAgentRegistry([createDesignEngineerAgent(options.strategy)]),
    availableWorkflows: options.availableWorkflows ?? SUPPORTED,
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.models !== undefined ? { models: options.models } : {}),
  });
}

describe("the deterministic strategy", () => {
  test("product-shell implementation intent selects implementation without write consent", async () => {
    const result = await runtimeWith({
      tools: classifierTool("page"),
      strategy: deterministicDesignEngineerStrategy,
    }).decide({
      ...TASK,
      request: "Implement the selected design at /expenses in the detected project. Prepare reviewed implementation changes.",
      input: {
        ...(TASK.input as object),
        project: { id: "p1", name: "Fixture", rootPath: "/tmp/fixture" },
        destination: { label: "/expenses", kind: "page", path: "/expenses" },
        implementationIntent: true,
      },
    });

    expect(result.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-implementation",
    });
  });

  test("a consented project selects implementation; a project alone does not", async () => {
    const withConsent = await runtimeWith({
      tools: classifierTool("page"),
      strategy: deterministicDesignEngineerStrategy,
    }).decide({
      ...TASK,
      input: { ...(TASK.input as object), project: { id: "p1", name: "Fixture" }, projectWriteConsent: true },
    });

    const withoutConsent = await runtimeWith({
      tools: classifierTool("page"),
      strategy: deterministicDesignEngineerStrategy,
    }).decide({
      ...TASK,
      input: { ...(TASK.input as object), project: { id: "p1", name: "Fixture" } },
    });

    expect(withConsent.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-implementation",
    });
    // Project presence is where changes COULD go, never permission: without
    // the explicit journey consent the supported specification route runs.
    expect(withoutConsent.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-figma-specification",
    });
  });

  test("a real Figma source selects the specification journey", async () => {
    const result = await runtimeWith({
      tools: classifierTool("page"),
      strategy: deterministicDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-figma-specification",
    });
  });

  test("the legacy scaffold is never selected: no Figma source clarifies with setup guidance", async () => {
    const result = await runtimeWith({
      tools: classifierTool("page"),
      strategy: deterministicDesignEngineerStrategy,
      availableWorkflows: ["design-to-code"],
    }).decide({ ...TASK, input: { designFile: "homepage.fig" } });

    expect(result.decision.type).toBe("request_clarification");
    if (result.decision.type === "request_clarification") {
      expect(result.decision.question).toContain("Figma");
      // Actionable, never internal vocabulary.
      expect(result.decision.question).not.toContain("design-to-code");
      expect(result.decision.question).not.toContain("experimental");
    }
  });

  test("a placeholder source mode is not a real Figma source", async () => {
    const result = await runtimeWith({
      tools: classifierTool("page"),
      strategy: deterministicDesignEngineerStrategy,
    }).decide({ ...TASK, input: { designFile: "homepage.fig", figmaSourceMode: "placeholder" } });

    expect(result.decision.type).toBe("request_clarification");
  });

  test("an unrecognisable request on a supported route still asks instead of running", async () => {
    const result = await runtimeWith({
      tools: classifierTool("unknown"),
      strategy: deterministicDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision.type).toBe("request_clarification");
  });

  test("the default export is still the deterministic agent", async () => {
    expect(designEngineerAgent.manifest.id).toBe("design-engineer-agent");

    const result = await new AgentRuntime({
      registry: new InMemoryAgentRegistry([designEngineerAgent]),
      availableWorkflows: SUPPORTED,
      tools: classifierTool("new_component"),
    }).decide(TASK);

    expect(result.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-figma-specification",
    });
  });
});

describe("the model-backed coordinator: intent interpretation over product actions", () => {
  function productModel(
    transport: unknown,
  ): ModelInvoker & { readonly seen: ModelInvocationRequest[] } {
    const seen: ModelInvocationRequest[] = [];
    return {
      seen,
      installedProfileIds: () => ["design-engineer-default"],
      generate: (request) => {
        seen.push(request);
        return Promise.resolve({
          type: "success",
          requestId: request.requestId,
          providerId: "openrouter",
          model: "openai/gpt-4o-mini",
          output: transport,
          durationMs: 1,
        });
      },
    };
  }

  function productModelSequence(
    transports: readonly unknown[],
  ): ModelInvoker & { readonly seen: ModelInvocationRequest[] } {
    const seen: ModelInvocationRequest[] = [];
    let index = 0;
    return {
      seen,
      installedProfileIds: () => ["design-engineer-default"],
      generate: (request) => {
        seen.push(request);
        const output = transports[Math.min(index++, transports.length - 1)];
        return Promise.resolve({
          type: "success" as const,
          requestId: request.requestId,
          providerId: "openrouter",
          model: "openai/gpt-4o-mini",
          output,
          durationMs: 1,
        });
      },
    };
  }

  const spec = { action: "create_specification", question: null, reason: null, reasoningSummary: "documentation intent" };
  const impl = { action: "prepare_implementation", question: null, reason: null, reasoningSummary: "implementation intent" };

  const CONSENTED = {
    ...TASK,
    request: "implement this design in my project",
    input: { ...(TASK.input as object), project: { id: "p1", name: "Fixture" }, projectWriteConsent: true },
  };

  const PRODUCT_INTENT = {
    ...TASK,
    request: "Implement the selected design at /expenses in the detected project. Prepare reviewed implementation changes.",
    input: {
      ...(TASK.input as object),
      project: { id: "p1", name: "Fixture", rootPath: "/tmp/fixture" },
      destination: { label: "/expenses", kind: "page", path: "/expenses" },
      implementationIntent: true,
    },
  };

  test("an eligible specification request performs exactly one coordinator model call and routes to specification", async () => {
    const models = productModel(spec);
    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide({
      ...TASK,
      request: "document this Figma frame for engineering",
    });

    expect(models.seen).toHaveLength(1);
    expect(result.decision).toMatchObject({ type: "run_workflow", workflowId: "design-to-code-figma-specification" });
  });

  test("an eligible implementation request performs exactly one coordinator model call and routes to implementation", async () => {
    const models = productModel(impl);
    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);

    expect(models.seen).toHaveLength(1);
    expect(result.decision).toMatchObject({ type: "run_workflow", workflowId: "design-to-code-implementation" });
  });

  test("product-shell implementation intent keeps the Coordinator on implementation", async () => {
    const models = productModel(impl);
    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(PRODUCT_INTENT);

    expect(models.seen).toHaveLength(1);
    expect(result.decision).toMatchObject({ type: "run_workflow", workflowId: "design-to-code-implementation" });
    expect(models.seen[0]?.messages.map((message) => message.content).join("\n"))
      .toContain("the user selected a design and destination for implementation: true");
  });

  test("the model chooses specification even when implementation is available", async () => {
    const models = productModel(spec);
    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide({
      ...CONSENTED,
      request: "review the design but do not change the project",
    });

    expect(result.decision).toMatchObject({ type: "run_workflow", workflowId: "design-to-code-figma-specification" });
  });

  test("the prompt offers product actions and safe facts — never workflow ids", async () => {
    const models = productModel(spec);
    await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);

    const prompt = models.seen[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("create_specification");
    expect(prompt).toContain("prepare_implementation");
    expect(prompt).not.toContain("design-to-code");
    expect(prompt).not.toContain("workflow id");
  });

  test("a disallowed action is rejected: implementation without consent cannot be accepted", async () => {
    // No consent → prepare_implementation is not in the allowed set; the
    // model answering it anyway is refused deterministically.
    const models = productModelSequence([impl, spec]);
    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(TASK);

    expect(models.seen).toHaveLength(2);
    expect(result.decision).toMatchObject({ type: "run_workflow", workflowId: "design-to-code-figma-specification" });
    expect(models.seen[1]?.messages[0]?.content).toContain("ERR_COORDINATOR_ACTION_NOT_ALLOWED");
    expect(models.seen[1]?.messages[0]?.content).toContain("create_specification, request_clarification, decline");
  });

  test("an invented action or workflow id cannot be accepted", async () => {
    const rogue = productModelSequence([
      { action: "run_workflow", workflowId: "design-to-code", question: null, reason: null, reasoningSummary: "x" },
      { action: "create_specification", question: null, reason: null, reasoningSummary: "x" },
    ]);
    const result = await runtimeWith({ models: rogue, strategy: modelDesignEngineerStrategy }).decide(TASK);

    expect(rogue.seen).toHaveLength(2);
    expect(result.decision.type).toBe("run_workflow");
  });

  test("malformed JSON repairs once, then dispatches only the valid decision", async () => {
    const models = productModelSequence([
      "{not-json",
      impl,
    ]);

    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);

    expect(models.seen).toHaveLength(2);
    expect(result.decision).toMatchObject({ type: "run_workflow", workflowId: "design-to-code-implementation" });
    expect(models.seen[1]?.messages[0]?.content).toContain("ERR_COORDINATOR_OUTPUT_JSON_INVALID");
  });

  test("provider output failure repairs, while transport failure does not", async () => {
    const repairable: ModelInvoker & { readonly seen: ModelInvocationRequest[] } = {
      seen: [],
      installedProfileIds: () => ["design-engineer-default"],
      generate: (request) => {
        repairable.seen.push(request);
        if (repairable.seen.length === 1) {
          return Promise.resolve({
            type: "failure" as const,
            requestId: request.requestId,
            code: "ERR_MODEL_OUTPUT_JSON_INVALID",
            message: "bounded provider output classification",
            retryable: false,
            durationMs: 1,
          });
        }
        return Promise.resolve({
          type: "success" as const,
          requestId: request.requestId,
          providerId: "openrouter",
          model: "openai/gpt-4o-mini",
          output: impl,
          durationMs: 1,
        });
      },
    };
    const transportFailure: ModelInvoker & { readonly seen: ModelInvocationRequest[] } = {
      seen: [],
      installedProfileIds: () => ["design-engineer-default"],
      generate: (request) => {
        transportFailure.seen.push(request);
        return Promise.resolve({
          type: "failure" as const,
          requestId: request.requestId,
          code: "ERR_MODEL_AUTHENTICATION",
          message: "credential detail must stay private",
          retryable: false,
          durationMs: 1,
        });
      },
    };

    const repaired = await runtimeWith({ models: repairable, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);
    const failed = await runtimeWith({ models: transportFailure, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);

    expect(repairable.seen).toHaveLength(2);
    expect(repaired.decision.type).toBe("run_workflow");
    expect(transportFailure.seen).toHaveLength(1);
    expect(failed.decision.type).toBe("decline");
  });

  test("schema-invalid output repairs with bounded strict feedback", async () => {
    const models = productModelSequence([
      { action: "prepare_implementation", question: null, reason: null },
      impl,
    ]);

    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);

    expect(models.seen).toHaveLength(2);
    expect(result.decision.type).toBe("run_workflow");
    expect(models.seen[1]?.messages[0]?.content).toContain("ERR_COORDINATOR_OUTPUT_SCHEMA_INVALID");
    expect(models.seen[1]?.messages[0]?.content).toContain("Return only an object satisfying the required Coordinator schema.");
  });

  test("two invalid attempts exhaust with a typed stop and no decision", async () => {
    const models = productModelSequence(["bad", "still bad"]);

    await expect(
      runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(CONSENTED),
    ).rejects.toMatchObject({ code: "ERR_COORDINATOR_OUTPUT_ATTEMPTS_EXHAUSTED" });
    expect(models.seen).toHaveLength(2);
  });

  test("valid decline and clarification are not retried", async () => {
    const decline = productModel({ action: "decline", question: null, reason: "outside scope", reasoningSummary: "not a design" });
    const clarification = productModel({ action: "request_clarification", question: "Which frame?", reason: null, reasoningSummary: "unclear" });

    const declined = await runtimeWith({ models: decline, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);
    const asked = await runtimeWith({ models: clarification, strategy: modelDesignEngineerStrategy }).decide(CONSENTED);

    expect(decline.seen).toHaveLength(1);
    expect(clarification.seen).toHaveLength(1);
    expect(declined.decision.type).toBe("decline");
    expect(asked.decision.type).toBe("request_clarification");
  });

  test("cancellation between invalid output and repair prevents attempt two", async () => {
    const controller = new AbortController();
    const models: ModelInvoker & { readonly seen: ModelInvocationRequest[] } = {
      seen: [],
      installedProfileIds: () => ["design-engineer-default"],
      generate: (request) => {
        models.seen.push(request);
        controller.abort();
        return Promise.resolve({
          type: "success" as const,
          requestId: request.requestId,
          providerId: "openrouter",
          model: "openai/gpt-4o-mini",
          output: "bad",
          durationMs: 1,
        });
      },
    };

    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(CONSENTED, controller.signal);

    expect(models.seen).toHaveLength(1);
    expect(result.decision.type).toBe("decline");
  });

  test("a model failure declines with a safe reason, never a silent deterministic fallback", async () => {
    const failing: ModelInvoker = {
      installedProfileIds: () => ["design-engineer-default"],
      generate: (request) =>
        Promise.resolve({
          type: "failure",
          requestId: request.requestId,
          code: "ERR_MODEL_TIMEOUT",
          message: "provider says no",
          retryable: false,
          durationMs: 1,
        }),
    };

    const result = await runtimeWith({ models: failing, strategy: modelDesignEngineerStrategy }).decide(TASK);
    expect(result.decision.type).toBe("decline");
    expect(JSON.stringify(result.decision)).not.toContain("provider says no");
  });

  test("missing prerequisites short-circuit with zero model calls", async () => {
    const models = productModel(spec);
    const noFigma = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide({
      ...TASK,
      input: { designFile: "homepage.fig" },
    });
    const empty = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide({
      ...TASK,
      request: "",
      input: undefined,
    });

    expect(noFigma.decision.type).toBe("request_clarification");
    expect(empty.decision.type).toBe("request_clarification");
    expect(models.seen).toHaveLength(0);
  });

  test("the task's own input is passed through unchanged on a routed run", async () => {
    const models = productModel(spec);
    const result = await runtimeWith({ models, strategy: modelDesignEngineerStrategy }).decide(TASK);

    expect(result.decision.type === "run_workflow" ? result.decision.input : undefined).toEqual(
      TASK.input,
    );
  });
});
