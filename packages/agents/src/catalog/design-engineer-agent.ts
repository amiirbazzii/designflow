// packages/agents/src/catalog/design-engineer-agent.ts
import { agentManifestSchema } from "@designflow/sdk";
import type { Agent, AgentContext, AgentDecision, AgentManifest, AgentTask } from "@designflow/sdk";

/**
 * The Design Engineer's agent.
 *
 * Deterministic, and openly so. It has one permitted workflow, so "choosing"
 * is not yet a decision worth making — what it proves is the *path*: a worker
 * delegates, an agent answers, the answer is validated against an allow-list,
 * and only then does the engine run anything. Every one of those steps is real
 * here; only the reasoning is trivial.
 *
 * Written against the same contracts an LLM-backed agent will use, so the day
 * `decide` starts calling a model, nothing around it changes — including the
 * checks that stop a model choosing a workflow it may not run.
 *
 * No LLM dependency, no memory, no tools. Those are later stages, and adding a
 * placeholder for them now would be inventing an interface before there is a
 * caller to shape it.
 */

export const designEngineerAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "design-engineer-agent",
  name: "Design Engineer Agent",
  description: "Decides how a Design Engineer request should be carried out",
  version: "0.1.0",
  instructions:
    "Turn a design into working code. Run the design-to-code workflow when the " +
    "request names something to build. Ask for the design file when it does not.",
  allowedWorkflows: ["design-to-code"],
  metadata: {
    author: "DesignFlow",
    deterministic: true,
  },
});

/**
 * Whether there is enough to act on.
 *
 * A request that is blank *and* carries no structured input describes no work,
 * and guessing what was meant is exactly the behaviour agents are supposed to
 * replace. Either one alone is enough: the CLI form produces input without
 * prose, and a bare `designflow run` produces prose without a form.
 */
function hasSomethingToDo(task: AgentTask): boolean {
  if (task.request.trim().length > 0) return true;

  const { input } = task;
  if (input === undefined || input === null) return false;

  // A form that was rendered but left entirely empty is not input.
  if (typeof input === "object") return Object.keys(input).length > 0;

  return String(input).trim().length > 0;
}

class DesignEngineerAgent implements Agent {
  public readonly manifest = designEngineerAgentManifest;

  public decide(task: AgentTask, context: AgentContext): Promise<AgentDecision> {
    if (!hasSomethingToDo(task)) {
      return Promise.resolve({
        type: "request_clarification",
        question:
          "Which design should I build? Name a design file, or describe what you want made.",
        reasoningSummary: "The request named nothing to work from.",
      });
    }

    const workflowId = this.manifest.allowedWorkflows[0];

    // Unreachable for a parsed manifest — `allowedWorkflows` is `.min(1)`.
    // Declining rather than asserting keeps a misconfigured install refusing
    // work instead of throwing from under the runtime.
    if (workflowId === undefined || !context.availableWorkflows.includes(workflowId)) {
      return Promise.resolve({
        type: "decline",
        reason: "The design-to-code workflow is not available in this installation.",
        reasoningSummary: "No permitted workflow is installed.",
      });
    }

    return Promise.resolve({
      type: "run_workflow",
      workflowId,
      ...(task.input !== undefined ? { input: task.input } : {}),
      reasoningSummary: "The request describes design work, which design-to-code handles.",
    });
  }
}

export const designEngineerAgent: Agent = new DesignEngineerAgent();
