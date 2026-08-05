// packages/agents/src/catalog/qa-reviewer-agent.ts
import {
  agentManifestSchema,
  modelProfileSchema,
  type Agent,
  type AgentContext,
  type AgentDecision,
  type AgentManifest,
  type AgentTask,
  type ModelProfile,
} from "@designflow/sdk";

import { buildDecisionPrompt, modelDecisionFromTransport } from "../decision-prompt";
import {
  describeTask,
  readClarifications,
  readMemoryNotes,
  readProjectFacts,
  readyToDecide,
} from "./task-helpers";

/**
 * The QA Reviewer's agent.
 *
 * Same two-strategy shape as the Design Engineer
 * (`design-engineer-agent.ts`): a manifest that is the reviewed answer to
 * "what may this agent do", and an interchangeable `decide` strategy chosen
 * once at composition-root wiring time. Targets `qa-review`, not
 * `design-to-code` — this agent decides whether a *review* should run, never
 * whether a design should be built.
 */

const MODEL_PROFILE_ID = "qa-reviewer-default";

export const qaReviewerAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "qa-reviewer-agent",
  name: "QA Reviewer Agent",
  description: "Decides how a QA review request should be carried out",
  version: "0.2.0",
  instructions:
    "Review the supplied implementation for correctness, accessibility and consistency. " +
    "Run the qa-review workflow when a review target is described. Ask what to review when it is not.",
  allowedWorkflows: ["qa-review"],
  allowedTools: [
    "classify-review-target",
    "summarize-artifact-set",
    "accessibility-checklist",
  ],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

/** A distinct slug from every other agent's default — see the module docs on why that matters. */
export const qaReviewerDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "anthropic/claude-3.5-haiku",
});

/**
 * Turns the worker's flat form fields into `qa-review`'s actual input shape.
 *
 * The CLI/API form only collects what a person can type in three lines
 * (`reviewTarget`, `reviewScope`, `severityThreshold`) — `qa-review` itself
 * takes a structured review target (`id`, `description`, `items[]`). This is
 * the one place that gap is bridged: mechanical, deterministic reshaping of
 * the task's own input, never anything invented or model-produced.
 */
function shapeWorkflowInput(task: AgentTask): Record<string, unknown> {
  const input = typeof task.input === "object" && task.input !== null ? (task.input as Record<string, unknown>) : {};

  // `describeTask` falls back to a resumed session's clarification answer
  // when the original request/input was empty — the field a person actually
  // typed to answer "what should I review?".
  const described = describeTask(task);

  const reviewTarget = typeof input["reviewTarget"] === "string" && input["reviewTarget"].length > 0
    ? input["reviewTarget"]
    : described;

  const scope = Array.isArray(input["reviewScope"])
    ? input["reviewScope"].filter((entry): entry is string => typeof entry === "string")
    : [];

  const severityThreshold = typeof input["severityThreshold"] === "string" ? input["severityThreshold"] : undefined;

  return {
    id: reviewTarget,
    description: described.length > 0 ? described : reviewTarget,
    items: [{ path: reviewTarget, kind: "component" }],
    scope,
    ...(severityThreshold !== undefined ? { severityThreshold } : {}),
  };
}

export type QaReviewerStrategy = (
  task: AgentTask,
  context: AgentContext,
  manifest: AgentManifest,
) => Promise<AgentDecision>;

/**
 * Offline, no credential required. Consults `classify-review-target` when
 * it is available, but its verdict is informational — a review target
 * described at all is enough to run the workflow; the workflow itself is
 * what actually inspects and scores the target.
 */
export const deterministicQaReviewerStrategy: QaReviewerStrategy = async (
  task,
  context,
  manifest,
) => {
  const workflowId = manifest.allowedWorkflows[0];

  if (workflowId === undefined || !context.availableWorkflows.includes(workflowId)) {
    return {
      type: "decline",
      reason: "The qa-review workflow is not available in this installation.",
      reasoningSummary: "No permitted workflow is installed.",
    };
  }

  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question: "What should I review — which files or components, and what should I focus on?",
      reasoningSummary: "The request named nothing to review.",
    };
  }

  if (context.availableTools.includes("classify-review-target")) {
    await context.tools.call({
      id: `${task.workerId}-classify`,
      toolId: "classify-review-target",
      input: { request: describeTask(task) },
    });
  }

  return {
    type: "run_workflow",
    workflowId,
    input: shapeWorkflowInput(task),
    reasoningSummary: "The request describes a review target, which qa-review handles.",
  };
};

function declineForModelFailure(code: string): AgentDecision {
  const reason =
    code === "ERR_MODEL_SCHEMA_UNSUPPORTED"
      ? "The configured model rejected the required structured-output schema."
      : code === "ERR_MODEL_OUTPUT_UNSUPPORTED"
        ? "The configured model cannot return the required structured output."
        : code === "ERR_MODEL_RATE_LIMITED" || code === "ERR_MODEL_UNAVAILABLE"
      ? "The configured model is temporarily unavailable."
      : code === "ERR_MODEL_TIMEOUT"
        ? "The model took too long to respond."
        : code === "ERR_AGENT_MODEL_BUDGET_EXCEEDED"
          ? "This request needed more from the model than is allowed at once."
          : "The model could not be reached.";

  return { type: "decline", reason, reasoningSummary: "The configured model call did not succeed." };
}

export const modelQaReviewerStrategy: QaReviewerStrategy = async (task, context, manifest) => {
  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question: "What should I review — which files or components, and what should I focus on?",
      reasoningSummary: "The request named nothing to review.",
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

  const decision = modelDecisionFromTransport(result.output, context.availableWorkflows);
  if (decision === undefined) {
    return {
      type: "decline",
      reason: "The model's answer could not be used.",
      reasoningSummary: "The model did not return a usable structured decision.",
    };
  }

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

class QaReviewerAgent implements Agent {
  public readonly manifest: AgentManifest;
  private readonly strategy: QaReviewerStrategy;

  public constructor(manifest: AgentManifest, strategy: QaReviewerStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public decide(task: AgentTask, context: AgentContext): Promise<AgentDecision> {
    return this.strategy(task, context, this.manifest);
  }
}

export function createQaReviewerAgent(
  strategy: QaReviewerStrategy = deterministicQaReviewerStrategy,
): Agent {
  return new QaReviewerAgent(qaReviewerAgentManifest, strategy);
}

export const qaReviewerAgent: Agent = createQaReviewerAgent();
