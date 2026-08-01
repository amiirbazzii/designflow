// packages/agents/src/catalog/research-analyst-agent.ts
import { agentManifestSchema, modelProfileSchema } from "@designflow/sdk";
import type { Agent, AgentContext, AgentDecision, AgentManifest, AgentTask, ModelProfile } from "@designflow/sdk";
import { buildDecisionPrompt, modelDecisionSchema } from "../decision-prompt";
import {
  describeTask,
  readClarifications,
  readMemoryNotes,
  readProjectFacts,
  readyToDecide,
} from "./task-helpers";

/**
 * The Research Analyst's agent. Same two-strategy shape as the Design
 * Engineer and QA Reviewer agents; targets `research-analysis` only.
 */

const MODEL_PROFILE_ID = "research-analyst-default";

export const researchAnalystAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "research-analyst-agent",
  name: "Research Analyst Agent",
  description: "Decides how a research request should be carried out",
  version: "0.1.0",
  instructions:
    "Organize a bounded research request over the sources supplied. Run the " +
    "research-analysis workflow when a question and sources are described. Ask for " +
    "the missing one when only a question or only sources are present.",
  allowedWorkflows: ["research-analysis"],
  allowedTools: [
    "classify-research-request",
    "validate-source-metadata",
    "extract-structured-claims",
  ],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

/** A distinct slug from every other agent's default. */
export const researchAnalystDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "perplexity/sonar",
});

/**
 * Turns the worker's flat form fields into `research-analysis`'s actual
 * input shape (`question`, `sources: SourceInput[]`).
 *
 * The form only collects a comma-separated list of source names — the
 * workflow needs each source as an object with `id`/`title`/`content`. This
 * mechanically wraps each name into a minimal, valid source: the name
 * stands in for both id and content, deterministically, with nothing
 * invented beyond that.
 */
function shapeWorkflowInput(task: AgentTask): Record<string, unknown> {
  const input = typeof task.input === "object" && task.input !== null ? (task.input as Record<string, unknown>) : {};

  // `describeTask` falls back to a resumed session's clarification answer
  // when the original request/input was empty.
  const question = typeof input["researchQuestion"] === "string" && input["researchQuestion"].length > 0
    ? input["researchQuestion"]
    : describeTask(task);

  const sourceNames = Array.isArray(input["sources"])
    ? input["sources"].filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];

  return {
    question,
    sources: sourceNames.map((name) => ({ id: name, title: name, content: name })),
  };
}

export type ResearchAnalystStrategy = (
  task: AgentTask,
  context: AgentContext,
  manifest: AgentManifest,
) => Promise<AgentDecision>;

export const deterministicResearchAnalystStrategy: ResearchAnalystStrategy = async (
  task,
  context,
  manifest,
) => {
  const workflowId = manifest.allowedWorkflows[0];

  if (workflowId === undefined || !context.availableWorkflows.includes(workflowId)) {
    return {
      type: "decline",
      reason: "The research-analysis workflow is not available in this installation.",
      reasoningSummary: "No permitted workflow is installed.",
    };
  }

  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question: "What would you like researched, and what sources should I use?",
      reasoningSummary: "The request named nothing to research.",
    };
  }

  if (context.availableTools.includes("classify-research-request")) {
    await context.tools.call({
      id: `${task.workerId}-classify`,
      toolId: "classify-research-request",
      input: { request: describeTask(task) },
    });
  }

  return {
    type: "run_workflow",
    workflowId,
    input: shapeWorkflowInput(task),
    reasoningSummary: "The request describes a research question, which research-analysis handles.",
  };
};

function declineForModelFailure(code: string): AgentDecision {
  const reason =
    code === "ERR_MODEL_RATE_LIMITED" || code === "ERR_MODEL_UNAVAILABLE"
      ? "The configured model is temporarily unavailable."
      : code === "ERR_MODEL_TIMEOUT"
        ? "The model took too long to respond."
        : code === "ERR_AGENT_MODEL_BUDGET_EXCEEDED"
          ? "This request needed more from the model than is allowed at once."
          : "The model could not be reached.";

  return { type: "decline", reason, reasoningSummary: "The configured model call did not succeed." };
}

export const modelResearchAnalystStrategy: ResearchAnalystStrategy = async (
  task,
  context,
  manifest,
) => {
  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question: "What would you like researched, and what sources should I use?",
      reasoningSummary: "The request named nothing to research.",
    };
  }

  const { messages, responseSchema } = buildDecisionPrompt({
    instructions: manifest.instructions,
    request: describeTask(task),
    inputSummary:
      typeof task.input === "object" && task.input !== null && !Array.isArray(task.input)
        ? (task.input as Record<string, unknown>)
        : undefined,
    availableWorkflows: context.availableWorkflows,
    availableTools: context.availableTools,
    clarifications: readClarifications(task),
    projectFacts: readProjectFacts(task),
    memoryNotes: readMemoryNotes(task),
  });

  const result = await context.model.generate({ messages, responseSchema, maxOutputTokens: 300 });

  if (result.type === "failure") return declineForModelFailure(result.code);

  const parsed = modelDecisionSchema.safeParse(result.output);
  if (!parsed.success) {
    return {
      type: "decline",
      reason: "The model's answer could not be used.",
      reasoningSummary: "The model did not return a usable structured decision.",
    };
  }

  const decision = parsed.data;

  if (decision.type === "run_workflow") {
    return {
      type: "run_workflow",
      workflowId: decision.workflowId,
      input: shapeWorkflowInput(task),
      reasoningSummary: decision.reasoningSummary,
    };
  }

  if (decision.type === "request_clarification") {
    return { type: "request_clarification", question: decision.question, reasoningSummary: decision.reasoningSummary };
  }

  return { type: "decline", reason: decision.reason, reasoningSummary: decision.reasoningSummary };
};

class ResearchAnalystAgent implements Agent {
  public readonly manifest: AgentManifest;
  private readonly strategy: ResearchAnalystStrategy;

  public constructor(manifest: AgentManifest, strategy: ResearchAnalystStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public decide(task: AgentTask, context: AgentContext): Promise<AgentDecision> {
    return this.strategy(task, context, this.manifest);
  }
}

export function createResearchAnalystAgent(
  strategy: ResearchAnalystStrategy = deterministicResearchAnalystStrategy,
): Agent {
  return new ResearchAnalystAgent(researchAnalystAgentManifest, strategy);
}

export const researchAnalystAgent: Agent = createResearchAnalystAgent();
