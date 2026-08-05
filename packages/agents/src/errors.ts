// packages/agents/src/errors.ts
import { DesignFlowError } from "@designflow/sdk";

/**
 * Agent failures, each with a stable code.
 *
 * Codes rather than message text, because a caller deciding what to do about a
 * failure — retry, ask the user, refuse — must not be reading English. The
 * message is for a person; `code` is the contract.
 *
 * The two workflow refusals are separate codes on purpose. "The agent chose
 * something it is not permitted to choose" is a trust problem, and "the agent
 * chose something this installation does not have" is a deployment problem.
 * One code for both would make the first invisible inside the second.
 */

/**
 * Every stable code this layer can raise.
 *
 * Enumerated so the CLI's user-facing error table can be checked against it: a
 * code added here without a message there fails a test rather than reaching a
 * person as raw internal text. That is not hypothetical — it is exactly what
 * happened when this package was introduced.
 */
export const AGENT_ERROR_CODES = [
  "ERR_AGENT_NOT_FOUND",
  "ERR_AGENT_ALREADY_REGISTERED",
  "ERR_AGENT_TASK_INVALID",
  "ERR_AGENT_DECISION_INVALID",
  "ERR_AGENT_WORKFLOW_NOT_ALLOWED",
  "ERR_AGENT_WORKFLOW_UNAVAILABLE",
  "ERR_AGENT_TOOL_BUDGET_EXCEEDED",
  "ERR_AGENT_MODEL_BUDGET_EXCEEDED",
  "ERR_AGENT_INVOCATION_REQUEST_INVALID",
  "ERR_AGENT_INVOCATION_OUTPUT_INVALID",
  "ERR_AGENT_INVOCATION_FAILED",
  "ERR_AGENT_MODEL_SERVICE_UNAVAILABLE",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export class AgentNotFoundError extends DesignFlowError {
  public constructor(agentId: string, available: readonly string[]) {
    super("ERR_AGENT_NOT_FOUND", `No such agent: ${agentId}`, {
      agentId,
      available: [...available],
    });
    this.name = "AgentNotFoundError";
    Object.setPrototypeOf(this, AgentNotFoundError.prototype);
  }
}

export class DuplicateAgentError extends DesignFlowError {
  public constructor(agentId: string) {
    super(
      "ERR_AGENT_ALREADY_REGISTERED",
      `An agent is already registered as: ${agentId}`,
      { agentId },
    );
    this.name = "DuplicateAgentError";
    Object.setPrototypeOf(this, DuplicateAgentError.prototype);
  }
}

/**
 * The task handed to the runtime was not a task.
 *
 * Raised before the agent is ever consulted — a malformed task cannot produce
 * a meaningful decision, and consulting an agent with one would only move the
 * failure somewhere harder to read.
 */
export class AgentTaskInvalidError extends DesignFlowError {
  public constructor(issues: readonly string[]) {
    super("ERR_AGENT_TASK_INVALID", `Invalid agent task: ${issues.join("; ")}`, {
      issues: [...issues],
    });
    this.name = "AgentTaskInvalidError";
    Object.setPrototypeOf(this, AgentTaskInvalidError.prototype);
  }
}

/**
 * The agent returned something that is not a decision.
 *
 * Includes the case that matters most: a decision carrying extra keys. The
 * decision schema is strict, so private reasoning smuggled alongside a valid
 * `run_workflow` lands here rather than in a log.
 */
export class AgentDecisionInvalidError extends DesignFlowError {
  public constructor(agentId: string, issues: readonly string[]) {
    super(
      "ERR_AGENT_DECISION_INVALID",
      `Agent ${agentId} returned an invalid decision: ${issues.join("; ")}`,
      { agentId, issues: [...issues] },
    );
    this.name = "AgentDecisionInvalidError";
    Object.setPrototypeOf(this, AgentDecisionInvalidError.prototype);
  }
}

/** The agent chose a workflow its own manifest does not permit. */
export class AgentWorkflowNotAllowedError extends DesignFlowError {
  public constructor(
    agentId: string,
    workflowId: string,
    allowedWorkflows: readonly string[],
  ) {
    super(
      "ERR_AGENT_WORKFLOW_NOT_ALLOWED",
      `Agent ${agentId} may not run workflow: ${workflowId}`,
      { agentId, workflowId, allowedWorkflows: [...allowedWorkflows] },
    );
    this.name = "AgentWorkflowNotAllowedError";
    Object.setPrototypeOf(this, AgentWorkflowNotAllowedError.prototype);
  }
}

/** The agent chose a permitted workflow this installation does not have. */
export class AgentWorkflowUnavailableError extends DesignFlowError {
  public constructor(
    agentId: string,
    workflowId: string,
    availableWorkflows: readonly string[],
  ) {
    super(
      "ERR_AGENT_WORKFLOW_UNAVAILABLE",
      `Workflow ${workflowId} is not installed, so agent ${agentId} cannot run it`,
      { agentId, workflowId, availableWorkflows: [...availableWorkflows] },
    );
    this.name = "AgentWorkflowUnavailableError";
    Object.setPrototypeOf(this, AgentWorkflowUnavailableError.prototype);
  }
}

/** The request handed to `AgentInvocationRuntime.invoke` was not a request. */
export class AgentInvocationRequestInvalidError extends DesignFlowError {
  public constructor(issues: readonly string[]) {
    super(
      "ERR_AGENT_INVOCATION_REQUEST_INVALID",
      `Invalid agent invocation request: ${issues.join("; ")}`,
      { issues: [...issues] },
    );
    this.name = "AgentInvocationRequestInvalidError";
    Object.setPrototypeOf(this, AgentInvocationRequestInvalidError.prototype);
  }
}

/**
 * A specialized agent's `perform` returned something that failed the
 * agent's own output schema.
 *
 * Raised by the specialized agent itself, not by `AgentInvocationRuntime` —
 * only the agent knows its own output contract. The runtime's job is to turn
 * this (or any other thrown error) into a `failure` outcome rather than let
 * it propagate as an unhandled rejection.
 */
export class SpecializedAgentOutputInvalidError extends DesignFlowError {
  public constructor(agentId: string, issues: readonly string[]) {
    super(
      "ERR_AGENT_INVOCATION_OUTPUT_INVALID",
      `Agent ${agentId} produced output that failed its own schema: ${issues.join("; ")}`,
      { agentId, issues: [...issues] },
    );
    this.name = "SpecializedAgentOutputInvalidError";
    Object.setPrototypeOf(this, SpecializedAgentOutputInvalidError.prototype);
  }
}
