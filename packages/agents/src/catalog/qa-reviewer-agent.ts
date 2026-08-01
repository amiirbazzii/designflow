// packages/agents/src/catalog/qa-reviewer-agent.ts
import { agentManifestSchema, modelProfileSchema } from "@designflow/sdk";
import type { Agent, AgentDecision, AgentManifest, ModelProfile } from "@designflow/sdk";
import { buildDecisionPrompt, modelDecisionSchema } from "../decision-prompt";

/**
 * A second, deliberately minimal model-backed agent.
 *
 * Exists for exactly one reason: the Design Engineer alone cannot prove
 * "every agent independently configurable" is architecture rather than a
 * one-agent coincidence. This agent shares no code path with the Design
 * Engineer beyond the generic building blocks every model-backed agent is
 * meant to reuse (`buildDecisionPrompt`, `modelDecisionSchema`,
 * `AgentContext.model`) — its manifest, its profile id, and its configured
 * model slug are all its own.
 *
 * Not registered in `BUILT_IN_AGENTS` — it ships no workflow of its own and
 * is not part of the product's default install. It is real, schema-validated
 * production code, constructed and exercised the same way any agent is.
 */

const MODEL_PROFILE_ID = "qa-reviewer-default";

export const qaReviewerAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "qa-reviewer-agent",
  name: "QA Reviewer Agent",
  description: "Decides whether a finished design change is ready to ship",
  version: "0.1.0",
  instructions:
    "Decide whether the described change is ready to run through design-to-code, " +
    "or needs more detail first.",
  allowedWorkflows: ["design-to-code"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

/**
 * A distinct provider slug from the Design Engineer's default
 * (`openai/gpt-4o-mini`) — the point being proven is that two agents each
 * name their own model, not that they happen to agree.
 */
export const qaReviewerDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "anthropic/claude-3.5-haiku",
});

export const qaReviewerAgent: Agent = {
  manifest: qaReviewerAgentManifest,
  decide: async (task, context) => {
    const { messages, responseSchema } = buildDecisionPrompt({
      instructions: qaReviewerAgentManifest.instructions,
      request: task.request,
      inputSummary:
        typeof task.input === "object" && task.input !== null
          ? (task.input as Readonly<Record<string, unknown>>)
          : undefined,
      availableWorkflows: context.availableWorkflows,
      availableTools: context.availableTools,
    });

    const result = await context.model.generate({ messages, responseSchema });

    if (result.type !== "success") {
      return {
        type: "decline",
        reason: "This worker could not reach its configured model.",
        reasoningSummary: "Model call failed.",
      };
    }

    const parsed = modelDecisionSchema.safeParse(result.output);
    if (!parsed.success) {
      return {
        type: "decline",
        reason: "This worker's model returned an answer it could not use.",
        reasoningSummary: "Model output failed local validation.",
      };
    }

    const decision = parsed.data;

    if (decision.type === "run_workflow") {
      const runDecision: AgentDecision = {
        type: "run_workflow",
        workflowId: decision.workflowId,
        ...(task.input !== undefined ? { input: task.input } : {}),
        reasoningSummary: decision.reasoningSummary,
      };
      return runDecision;
    }

    return decision;
  },
};
