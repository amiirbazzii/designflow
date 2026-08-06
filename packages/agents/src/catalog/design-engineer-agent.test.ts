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
import { InMemoryAgentRegistry } from "../registry";
import { AgentRuntime } from "../runtime";
import {
  createDesignEngineerAgent,
  deterministicDesignEngineerStrategy,
  designEngineerAgent,
  modelDesignEngineerStrategy,
} from "./design-engineer-agent";

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
  request: "build a login page",
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

function modelSpy(): ModelInvoker & { readonly seen: ModelInvocationRequest[] } {
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
        output: { type: "decline", workflowId: null, question: null, reason: "unused" },
        durationMs: 1,
      });
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

describe("the model strategy: prerequisites rule, the model does not", () => {
  test("a real Figma source routes to specification without consulting the model", async () => {
    const models = modelSpy();
    const result = await runtimeWith({
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-figma-specification",
    });
    expect(models.seen).toHaveLength(0);
  });

  test("a consented project routes to implementation without consulting the model", async () => {
    const models = modelSpy();
    const result = await runtimeWith({
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide({
      ...TASK,
      input: { ...(TASK.input as object), project: { id: "p1", name: "Fixture" }, projectWriteConsent: true },
    });

    expect(result.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-implementation",
    });
    expect(models.seen).toHaveLength(0);
  });

  test("missing prerequisites clarify — a model answer can never override them", async () => {
    const models = modelSpy();
    const result = await runtimeWith({
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide({ ...TASK, input: { designFile: "homepage.fig" } });

    expect(result.decision.type).toBe("request_clarification");
    expect(models.seen).toHaveLength(0);
  });

  test("an empty request never reaches the model at all", async () => {
    const models = modelSpy();
    const result = await runtimeWith({
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide({ ...TASK, request: "", input: undefined });

    expect(result.decision.type).toBe("request_clarification");
    expect(models.seen).toHaveLength(0);
  });

  test("the task's own input is passed through unchanged on a routed run", async () => {
    const result = await runtimeWith({
      models: modelSpy(),
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision.type === "run_workflow" ? result.decision.input : undefined).toEqual(
      TASK.input,
    );
  });
});
