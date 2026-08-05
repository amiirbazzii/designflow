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
 * The Design Engineer's two strategies, exercised through the real
 * `AgentRuntime` — the same path production traffic takes, with fake tool and
 * model layers standing in for `ToolRuntime` and `ModelRuntime`.
 */

const TASK: AgentTask = {
  workerId: "design-engineer",
  agentId: "design-engineer-agent",
  request: "build a login page",
  input: { designFile: "homepage.fig" },
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

function modelAnswering(
  output: unknown,
): ModelInvoker & { readonly seen: ModelInvocationRequest[] } {
  const seen: ModelInvocationRequest[] = [];

  return {
    seen,
    installedProfileIds: () => ["design-engineer-default"],
    generate: (request) => {
      seen.push(request);
      // Keep legacy fixture literals concise while sending the exact flat
      // transport shape that a strict provider receives in production.
      const transportOutput =
        typeof output === "object" && output !== null && "type" in output
          ? {
              ...(output as Record<string, unknown>),
              workflowId: (output as Record<string, unknown>).workflowId ?? null,
              question: (output as Record<string, unknown>).question ?? null,
              reason: (output as Record<string, unknown>).reason ?? null,
            }
          : output;
      return Promise.resolve({
        type: "success",
        requestId: request.requestId,
        providerId: "openrouter",
        model: "openai/gpt-4o-mini",
        output: transportOutput,
        durationMs: 1,
      });
    },
  };
}

function modelFailing(code: string): ModelInvoker {
  return {
    installedProfileIds: () => ["design-engineer-default"],
    generate: (request) =>
      Promise.resolve({
        type: "failure",
        requestId: request.requestId,
        code,
        message: "provider says no",
        retryable: false,
        durationMs: 1,
      }),
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
    availableWorkflows: options.availableWorkflows ?? ["design-to-code"],
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.models !== undefined ? { models: options.models } : {}),
  });
}

// ── The deterministic strategy is unaffected by this stage ──────

describe("the deterministic strategy", () => {
  test("selects implementation only when the installed Stage 4 workflow and project context are both present", async () => {
    const result = await runtimeWith({
      tools: classifierTool("page"),
      strategy: deterministicDesignEngineerStrategy,
      availableWorkflows: ["design-to-code", "design-to-code-implementation"],
    }).decide({ ...TASK, input: { ...TASK.input, project: { id: "p1", name: "Fixture" } } });

    expect(result.decision).toMatchObject({
      type: "run_workflow",
      workflowId: "design-to-code-implementation",
    });
  });

  test("still works explicitly, with no model layer installed at all", async () => {
    const tools = classifierTool("page");

    const result = await runtimeWith({
      tools,
      strategy: deterministicDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision.type).toBe("run_workflow");
  });

  test("the default export is still the deterministic agent", async () => {
    expect(designEngineerAgent.manifest.id).toBe("design-engineer-agent");

    const result = await new AgentRuntime({
      registry: new InMemoryAgentRegistry([designEngineerAgent]),
      availableWorkflows: ["design-to-code"],
      tools: classifierTool("new_component"),
    }).decide(TASK);

    expect(result.decision.type).toBe("run_workflow");
  });
});

// ── 36. The model result is load-bearing ────────────────────────

describe("the model strategy: load-bearing output", () => {
  test("a recognised decision runs the workflow", async () => {
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "This is page work.",
    });

    const result = await runtimeWith({
      tools: classifierTool("page"),
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision.type).toBe("run_workflow");
    expect(models.seen).toHaveLength(1);
  });

  test("the same task with a different model answer produces a different decision", async () => {
    // The only honest test of whether the model result matters: same task,
    // same tool result, only the model's answer changes.
    const asksQuestion = modelAnswering({
      type: "request_clarification",
      question: "What exactly should I build?",
      reasoningSummary: "Not enough detail.",
    });

    const declines = modelAnswering({
      type: "decline",
      reason: "Out of scope for this worker.",
      reasoningSummary: "Not design work.",
    });

    const runs = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "Clear design work.",
    });

    const [asked, declined, ran] = await Promise.all([
      runtimeWith({ tools: classifierTool("page"), models: asksQuestion, strategy: modelDesignEngineerStrategy }).decide(TASK),
      runtimeWith({ tools: classifierTool("page"), models: declines, strategy: modelDesignEngineerStrategy }).decide(TASK),
      runtimeWith({ tools: classifierTool("page"), models: runs, strategy: modelDesignEngineerStrategy }).decide(TASK),
    ]);

    expect(asked.decision.type).toBe("request_clarification");
    expect(declined.decision.type).toBe("decline");
    expect(ran.decision.type).toBe("run_workflow");
  });

  test("the task's own input is used, never anything the model invents", async () => {
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
      // Even if a compromised model tried to smuggle input, the schema has no
      // field for it — `modelDecisionSchema` would refuse this shape. Tested
      // here via the strategy's own conversion, which never reads one even
      // when present in the raw (unknown) output.
    });

    const result = await runtimeWith({
      tools: classifierTool("page"),
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision.type === "run_workflow" ? result.decision.input : undefined).toEqual(
      TASK.input,
    );
  });
});

// ── 37. Tool results inform the model request ───────────────────

describe("the model strategy: tool results inform the prompt", () => {
  test("the classifier is consulted before the model", async () => {
    const tools = classifierTool("new_component");
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    await runtimeWith({ tools, models, strategy: modelDesignEngineerStrategy }).decide(TASK);

    expect(tools.seen).toHaveLength(1);
    expect(models.seen).toHaveLength(1);
  });

  test("the classifier's verdict appears in what the model is shown", async () => {
    const tools = classifierTool("modify_component");
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    await runtimeWith({ tools, models, strategy: modelDesignEngineerStrategy }).decide(TASK);

    const prompt = models.seen[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("modify_component");
  });
});

// ── A resumed session's clarification reaches the model ─────────

describe("the model strategy: a resumed session's answer reaches the model", () => {
  test("task.context.clarifications appears in what the model is shown", async () => {
    const tools = classifierTool("unknown");
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const resumedTask: AgentTask = {
      ...TASK,
      context: {
        clarifications: [{ question: "Which component?", answer: "the header" }],
      },
    };

    await runtimeWith({ tools, models, strategy: modelDesignEngineerStrategy }).decide(
      resumedTask,
    );

    const prompt = models.seen[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("Which component?");
    expect(prompt).toContain("the header");
  });

  test("a fresh task (no context) produces the same prompt as before context existed", async () => {
    const tools = classifierTool("new_component");
    const modelsFresh = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });
    const modelsNoContext = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    await runtimeWith({
      tools: classifierTool("new_component"),
      models: modelsFresh,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);
    await runtimeWith({
      tools,
      models: modelsNoContext,
      strategy: modelDesignEngineerStrategy,
    }).decide({ ...TASK, context: {} });

    expect(modelsFresh.seen[0]?.messages).toEqual(modelsNoContext.seen[0]?.messages);
  });

  test("a malformed context is ignored rather than breaking the decision", async () => {
    const tools = classifierTool("new_component");
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const malformed: AgentTask = {
      ...TASK,
      context: { clarifications: "not-an-array" },
    };

    const result = await runtimeWith({
      tools,
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide(malformed);

    expect(result.decision.type).toBe("run_workflow");
  });
});

describe("the model strategy: Stage 40 project facts and memory reach the model", () => {
  test("task.context.project and task.context.memory appear in what the model is shown", async () => {
    const tools = classifierTool("new_component");
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const taskWithKnowledge: AgentTask = {
      ...TASK,
      context: {
        project: { id: "project-1", name: "Storefront", facts: [{ key: "project.framework", value: "react" }] },
        memory: [{ scope: "agent", key: "prefer.existingComponents", value: true }],
      },
    };

    await runtimeWith({ tools, models, strategy: modelDesignEngineerStrategy }).decide(taskWithKnowledge);

    const prompt = models.seen[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("project.framework");
    expect(prompt).toContain("prefer.existingComponents");
  });

  test("a task with no project/memory context produces the same prompt as before Stage 40", async () => {
    const modelsWithout = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });
    const modelsFresh = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    await runtimeWith({
      tools: classifierTool("new_component"),
      models: modelsFresh,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);
    await runtimeWith({
      tools: classifierTool("new_component"),
      models: modelsWithout,
      strategy: modelDesignEngineerStrategy,
    }).decide({ ...TASK, context: {} });

    expect(modelsFresh.seen[0]?.messages).toEqual(modelsWithout.seen[0]?.messages);
  });

  test("memory cannot change the tools or workflows the model is offered", async () => {
    const tools = classifierTool("new_component");
    const models = modelAnswering({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const rogueMemory: AgentTask = {
      ...TASK,
      context: {
        memory: [
          { scope: "agent", key: "allowedTools", value: ["shell-exec"] },
          { scope: "agent", key: "modelProfileId", value: "some-other-profile" },
        ],
      },
    };

    const result = await runtimeWith({ tools, models, strategy: modelDesignEngineerStrategy }).decide(
      rogueMemory,
    );

    // Memory content reaches the prompt as inert text — the model may *read*
    // it, but nothing here widens what it may actually choose: the permitted
    // list still names only the classifier, and the decision itself is still
    // enforced against the manifest's real `allowedTools`/`allowedWorkflows`
    // downstream in `AgentRuntime`, which this memory value never touches.
    expect(result.decision.type).toBe("run_workflow");
    const prompt = models.seen[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(prompt).toContain("Permitted tools already consulted: classify-design-task");
  });
});

// ── No silent fallback on model failure ─────────────────────────

describe("the model strategy: failure handling", () => {
  test("a model failure declines rather than running the deterministic path", async () => {
    const tools = classifierTool("page");

    const result = await runtimeWith({
      tools,
      models: modelFailing("ERR_MODEL_TIMEOUT"),
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    // Not `run_workflow` — a fallback to the classifier's own verdict would
    // be exactly the silent mode-switch this stage forbids.
    expect(result.decision.type).toBe("decline");
  });

  test("the decline never echoes the provider's raw message", async () => {
    const result = await runtimeWith({
      tools: classifierTool("page"),
      models: modelFailing("ERR_MODEL_AUTHENTICATION"),
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(JSON.stringify(result.decision)).not.toContain("provider says no");
  });

  test("invalid structured output declines rather than throwing", async () => {
    const malformed = modelAnswering({ type: "run_workflow" }); // missing required fields

    const result = await runtimeWith({
      tools: classifierTool("page"),
      models: malformed,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision.type).toBe("decline");
  });

  test("a workflow id outside the schema's enum is rejected before execution", async () => {
    // The provider schema constrains the enum and the post-parse conversion
    // remains authoritative when a provider ignores that constraint.
    const rogue = modelAnswering({
      type: "run_workflow",
      workflowId: "not-a-real-workflow",
      reasoningSummary: "ok",
    });

    const result = await runtimeWith({
      tools: classifierTool("page"),
      models: rogue,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision).toMatchObject({ type: "decline" });
  });

  // 39/40. Clarification and decline start no workflow — proven at the
  // decision level; `AgentRuntime` never calls a workflow regardless.
  test("clarification and decline decisions never name a workflow", async () => {
    const clarifying = modelAnswering({
      type: "request_clarification",
      question: "which design?",
      reasoningSummary: "unclear",
    });

    const result = await runtimeWith({
      tools: classifierTool("page"),
      models: clarifying,
      strategy: modelDesignEngineerStrategy,
    }).decide(TASK);

    expect(result.decision).not.toHaveProperty("workflowId");
  });

  test("an empty request never reaches the model at all", async () => {
    const models = modelAnswering({ type: "decline", reason: "x", reasoningSummary: "y" });

    const result = await runtimeWith({
      models,
      strategy: modelDesignEngineerStrategy,
    }).decide({ ...TASK, request: "", input: undefined });

    expect(result.decision.type).toBe("request_clarification");
    expect(models.seen).toHaveLength(0);
  });
});
