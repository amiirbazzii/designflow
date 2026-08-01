// packages/agents/src/catalog/product-manager-agent.ts
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
 * The Product Manager's agent. Same two-strategy shape as the other catalog
 * agents; targets `product-brief` only. Never a free-form chat responder —
 * every `run_workflow` decision produces the typed product-brief artifact.
 */

const MODEL_PROFILE_ID = "product-manager-default";

export const productManagerAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "product-manager-agent",
  name: "Product Manager Agent",
  description: "Decides how a product request should be turned into a structured brief",
  version: "0.1.0",
  instructions:
    "Turn a product request into a structured product brief: requirements, acceptance " +
    "criteria, risks and next actions. Run the product-brief workflow when the request " +
    "names a product need. Ask what problem is being solved when it does not.",
  allowedWorkflows: ["product-brief"],
  allowedTools: [
    "classify-product-request",
    "identify-requirement-gaps",
    "structure-acceptance-criteria",
  ],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

/** A distinct slug from every other agent's default. */
export const productManagerDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "google/gemini-2.0-flash-001",
});

/**
 * Turns the worker's flat form fields into `product-brief`'s actual input
 * shape. Most of the form's fields (`productRequest`, `targetUser`,
 * `constraints`) already match the workflow's schema by name; `outputScope`
 * is a depth choice with no matching workflow field (`desiredOutputScope`
 * defaults to `[]`), so it is dropped rather than forced into a shape it was
 * never meant to have.
 */
function shapeWorkflowInput(task: AgentTask): Record<string, unknown> {
  const input = typeof task.input === "object" && task.input !== null ? (task.input as Record<string, unknown>) : {};

  // `describeTask` falls back to a resumed session's clarification answer
  // when the original request/input was empty.
  const productRequest = typeof input["productRequest"] === "string" && input["productRequest"].length > 0
    ? input["productRequest"]
    : describeTask(task);

  const targetUser = typeof input["targetUser"] === "string" && input["targetUser"].length > 0
    ? input["targetUser"]
    : undefined;

  const constraints = Array.isArray(input["constraints"])
    ? input["constraints"].filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    productRequest,
    ...(targetUser !== undefined ? { targetUser } : {}),
    constraints,
  };
}

export type ProductManagerStrategy = (
  task: AgentTask,
  context: AgentContext,
  manifest: AgentManifest,
) => Promise<AgentDecision>;

export const deterministicProductManagerStrategy: ProductManagerStrategy = async (
  task,
  context,
  manifest,
) => {
  const workflowId = manifest.allowedWorkflows[0];

  if (workflowId === undefined || !context.availableWorkflows.includes(workflowId)) {
    return {
      type: "decline",
      reason: "The product-brief workflow is not available in this installation.",
      reasoningSummary: "No permitted workflow is installed.",
    };
  }

  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question: "What product need should this brief cover, and who is it for?",
      reasoningSummary: "The request named nothing to brief.",
    };
  }

  if (context.availableTools.includes("classify-product-request")) {
    await context.tools.call({
      id: `${task.workerId}-classify`,
      toolId: "classify-product-request",
      input: { request: describeTask(task) },
    });
  }

  return {
    type: "run_workflow",
    workflowId,
    input: shapeWorkflowInput(task),
    reasoningSummary: "The request describes a product need, which product-brief handles.",
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

export const modelProductManagerStrategy: ProductManagerStrategy = async (
  task,
  context,
  manifest,
) => {
  if (!readyToDecide(task)) {
    return {
      type: "request_clarification",
      question: "What product need should this brief cover, and who is it for?",
      reasoningSummary: "The request named nothing to brief.",
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

class ProductManagerAgent implements Agent {
  public readonly manifest: AgentManifest;
  private readonly strategy: ProductManagerStrategy;

  public constructor(manifest: AgentManifest, strategy: ProductManagerStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public decide(task: AgentTask, context: AgentContext): Promise<AgentDecision> {
    return this.strategy(task, context, this.manifest);
  }
}

export function createProductManagerAgent(
  strategy: ProductManagerStrategy = deterministicProductManagerStrategy,
): Agent {
  return new ProductManagerAgent(productManagerAgentManifest, strategy);
}

export const productManagerAgent: Agent = createProductManagerAgent();
