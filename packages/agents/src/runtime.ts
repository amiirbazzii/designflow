// packages/agents/src/runtime.ts
import { agentDecisionSchema, agentExecutionResultSchema, agentTaskSchema } from "@designflow/sdk";
import type {
  AgentContext,
  AgentDecision,
  AgentDecisionService,
  AgentExecutionResult,
  AgentTask,
  Logger,
} from "@designflow/sdk";
import type { ZodError } from "zod";
import type { InMemoryAgentRegistry } from "./registry";
import {
  AgentDecisionInvalidError,
  AgentTaskInvalidError,
  AgentWorkflowNotAllowedError,
  AgentWorkflowUnavailableError,
} from "./errors";

/**
 * The boundary an agent decision has to cross.
 *
 * Six steps, in order: validate the task, resolve the agent, build a
 * restricted context, ask, validate the answer, check the answer against both
 * allow-lists. What comes out the other side is a decision that has been
 * checked twice — once for shape, once for permission.
 *
 * What this deliberately does **not** do is act on it. It does not execute a
 * workflow, call `WorkflowRunner`, write an artifact, store memory, call a
 * model or loop. One task in, one decision out, no iteration — an agent that
 * could re-enter its own decision would be scheduling work, and scheduling
 * work is the engine's job.
 *
 * That single-shot shape is also what makes the runtime safe to sit in front
 * of an LLM later. When `decide` becomes a model call, everything downstream
 * of it here is unchanged: the model's answer is still parsed by a strict
 * schema and still checked against a list a human wrote.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface AgentRuntimeOptions {
  readonly registry: InMemoryAgentRegistry;
  /**
   * The workflows this installation can actually run.
   *
   * Supplied by the host rather than discovered, because the runtime has no
   * workflow resolver and should not grow one — knowing which workflows exist
   * is the composition root's knowledge, not the agent layer's.
   */
  readonly availableWorkflows: readonly string[];
  /** Ambient facts every agent sees. Per-request data travels on the task. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly logger?: Logger | undefined;
}

export class AgentRuntime implements AgentDecisionService {
  private readonly registry: InMemoryAgentRegistry;
  private readonly availableWorkflows: readonly string[];
  private readonly metadata: Readonly<Record<string, unknown>>;
  private readonly logger: Logger;

  public constructor(options: AgentRuntimeOptions) {
    this.registry = options.registry;
    this.availableWorkflows = [...options.availableWorkflows];
    this.metadata = options.metadata ?? {};
    this.logger = options.logger ?? silentLogger;
  }

  public async decide(
    task: AgentTask,
    signal?: AbortSignal,
  ): Promise<AgentExecutionResult> {
    const validated = this.parseTask(task);
    const agent = this.registry.require(validated.agentId);
    const { manifest } = agent;

    // Narrowed to the intersection: what the agent is permitted to choose and
    // what this installation has. An agent choosing from this list cannot
    // produce a decision the checks below then reject.
    const availableWorkflows = manifest.allowedWorkflows.filter((workflowId) =>
      this.availableWorkflows.includes(workflowId),
    );

    const context: AgentContext = {
      availableWorkflows,
      metadata: this.metadata,
      // A context without a signal would leave an agent unable to observe
      // cancellation, so one is always present — unaborted when none is given.
      signal: signal ?? new AbortController().signal,
      logger: this.logger,
    };

    const decision = this.parseDecision(
      manifest.id,
      await agent.decide(validated, context),
    );

    if (decision.type === "run_workflow") {
      // Checked against the manifest even though `availableWorkflows` was
      // already narrowed. The narrowing is a convenience for a well-behaved
      // agent; this is the enforcement, and it must not depend on the agent
      // having read the list it was handed.
      if (!manifest.allowedWorkflows.includes(decision.workflowId)) {
        throw new AgentWorkflowNotAllowedError(
          manifest.id,
          decision.workflowId,
          manifest.allowedWorkflows,
        );
      }

      if (!this.availableWorkflows.includes(decision.workflowId)) {
        throw new AgentWorkflowUnavailableError(
          manifest.id,
          decision.workflowId,
          this.availableWorkflows,
        );
      }
    }

    return agentExecutionResultSchema.parse({
      agentId: manifest.id,
      workerId: validated.workerId,
      decision,
    });
  }

  private parseTask(task: AgentTask): AgentTask {
    const result = agentTaskSchema.safeParse(task);

    if (!result.success) {
      throw new AgentTaskInvalidError(describe(result.error));
    }

    return result.data;
  }

  private parseDecision(agentId: string, decision: AgentDecision): AgentDecision {
    const result = agentDecisionSchema.safeParse(decision);

    if (!result.success) {
      throw new AgentDecisionInvalidError(agentId, describe(result.error));
    }

    return result.data;
  }
}

/** Zod issues as readable lines, so an error message names the field. */
function describe(error: ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}
