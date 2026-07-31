// packages/agents/src/catalog/design-engineer-agent.ts
import { agentManifestSchema } from "@designflow/sdk";
import type {
  Agent,
  AgentContext,
  AgentDecision,
  AgentManifest,
  AgentTask,
  ToolResult,
} from "@designflow/sdk";

/**
 * The Design Engineer's agent.
 *
 * Deterministic, and openly so. What it proves is the *path*: a worker
 * delegates, the agent consults a tool, the tool's answer changes what the
 * agent decides, the decision is validated against an allow-list, and only
 * then does the engine run anything. Every step is real; only the reasoning is
 * trivial.
 *
 * The tool call is **load-bearing**, not decorative. `classify-design-task`
 * decides between running the workflow and asking a question:
 *
 *   a recognised kind of design work  → run `design-to-code`
 *   `unknown`                         → ask what to build
 *
 * A request like "do the thing" reaches the agent with input attached and
 * would have run the workflow in Stage 35. Now it classifies as `unknown` and
 * gets a question instead. Deleting the tool call changes the outcome, which
 * is the only honest test of whether a tool matters.
 *
 * The tool is consulted defensively. A failure result — unavailable, refused,
 * timed out, over budget — is never fatal: the agent falls back to the input
 * check it used before. A decision-maker that breaks when its instruments do
 * is worse than one with no instruments.
 *
 * Written against the same contracts an LLM-backed agent will use, so the day
 * `decide` starts calling a model, nothing around it changes — including the
 * checks that stop a model choosing a workflow it may not run.
 */

export const designEngineerAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "design-engineer-agent",
  name: "Design Engineer Agent",
  description: "Decides how a Design Engineer request should be carried out",
  version: "0.2.0",
  instructions:
    "Turn a design into working code. Classify the request first. Run the " +
    "design-to-code workflow when it names design work. Ask what to build when it does not.",
  allowedWorkflows: ["design-to-code"],
  allowedTools: ["classify-design-task"],
  metadata: {
    author: "DesignFlow",
    deterministic: true,
  },
});

const CLASSIFIER = "classify-design-task";

/** The kinds of request that describe work `design-to-code` can do. */
const ACTIONABLE = new Set(["new_component", "modify_component", "page"]);

/**
 * Whether there is anything at all to act on.
 *
 * The floor beneath the classifier, not a replacement for it. A request that
 * is blank *and* carries no structured input describes no work, and there is
 * nothing to classify.
 */
function hasSomethingToDo(task: AgentTask): boolean {
  if (task.request.trim().length > 0) return true;

  const { input } = task;
  if (input === undefined || input === null) return false;

  if (typeof input === "object") return Object.keys(input).length > 0;

  return String(input).trim().length > 0;
}

/**
 * What the classifier said, or null when it could not be consulted.
 *
 * Null covers every failure mode identically — not installed, not permitted,
 * timed out, over budget, malformed output. The agent's fallback is the same
 * for all of them, so distinguishing them here would be detail without a
 * decision attached.
 */
function readClassification(result: ToolResult): { taskType: string; confidence: number } | null {
  if (result.type !== "success") return null;

  const { output } = result;
  if (typeof output !== "object" || output === null) return null;

  const taskType = (output as { taskType?: unknown }).taskType;
  const confidence = (output as { confidence?: unknown }).confidence;

  // Re-checked rather than trusted. The tool runtime already parsed this
  // against the tool's own output schema, but the agent holds `unknown` and
  // narrowing it here is cheaper than importing the tool package — which the
  // agent layer must not do, because it would depend on the tools it calls.
  return typeof taskType === "string" && typeof confidence === "number"
    ? { taskType, confidence }
    : null;
}

class DesignEngineerAgent implements Agent {
  public readonly manifest = designEngineerAgentManifest;

  public async decide(
    task: AgentTask,
    context: AgentContext,
  ): Promise<AgentDecision> {
    const workflowId = this.manifest.allowedWorkflows[0];

    // Unreachable for a parsed manifest — `allowedWorkflows` is `.min(1)`.
    // Declining rather than asserting keeps a misconfigured install refusing
    // work instead of throwing from under the runtime.
    if (workflowId === undefined || !context.availableWorkflows.includes(workflowId)) {
      return {
        type: "decline",
        reason: "The design-to-code workflow is not available in this installation.",
        reasoningSummary: "No permitted workflow is installed.",
      };
    }

    if (!hasSomethingToDo(task)) {
      return {
        type: "request_clarification",
        question:
          "Which design should I build? Name a design file, or describe what you want made.",
        reasoningSummary: "The request named nothing to work from.",
      };
    }

    const classification = context.availableTools.includes(CLASSIFIER)
      ? readClassification(
          await context.tools.call({
            id: `${task.workerId}-classify`,
            toolId: CLASSIFIER,
            input: { request: describe(task) },
          }),
        )
      : null;

    // The load-bearing branch. A request that describes nothing recognisable
    // gets a question, even though it carried enough input to start.
    if (classification !== null && !ACTIONABLE.has(classification.taskType)) {
      return {
        type: "request_clarification",
        question:
          "What would you like built? Describe a component, a page, or the change you want made.",
        reasoningSummary: "The request did not describe a recognisable kind of design work.",
      };
    }

    return {
      type: "run_workflow",
      workflowId,
      ...(task.input !== undefined ? { input: task.input } : {}),
      reasoningSummary:
        classification === null
          ? "The request describes design work, which design-to-code handles."
          : `The request looks like ${classification.taskType.replace(/_/g, " ")}, which design-to-code handles.`,
    };
  }
}

/**
 * The request as one string for the classifier.
 *
 * The prose request when there is one, with the structured input's values
 * appended — a CLI form produces `{designFile: "homepage.fig"}` and no prose,
 * and classifying an empty string would call every form submission unknown.
 */
function describe(task: AgentTask): string {
  const parts = [task.request];

  const { input } = task;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    for (const value of Object.values(input)) {
      parts.push(Array.isArray(value) ? value.join(" ") : String(value));
    }
  }

  return parts.filter((part) => part.length > 0).join(" ");
}

export const designEngineerAgent: Agent = new DesignEngineerAgent();
