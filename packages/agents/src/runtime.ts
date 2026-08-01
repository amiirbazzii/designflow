// packages/agents/src/runtime.ts
import {
  NOOP_AGENT_OBSERVER,
  NOOP_TRACE_OBSERVER,
  agentDecisionSchema,
  agentExecutionResultSchema,
  agentTaskSchema,
} from "@designflow/sdk";
import { DesignFlowError } from "@designflow/sdk";
import type {
  AgentContext,
  AgentDecision,
  AgentDecisionService,
  AgentExecutionResult,
  AgentManifest,
  AgentObservation,
  AgentObserver,
  AgentTask,
  Logger,
  ToolInvoker,
  TraceEvent,
  TraceObserver,
  TraceToolCall,
} from "@designflow/sdk";
import type { ZodError } from "zod";
import type { InMemoryAgentRegistry } from "./registry";
import {
  AgentScopedToolService,
  DEFAULT_MAX_TOOL_CALLS_PER_DECISION,
  EMPTY_TOOL_SERVICE,
} from "./tool-service";
import type { ObservedToolCall } from "./tool-service";
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
  /**
   * The tool layer, if one is installed.
   *
   * A port rather than `ToolRuntime`, which is what keeps this package's
   * dependency on `@designflow/sdk` alone true. Omitted, every agent gets a
   * service whose every call fails as unpermitted — tools are opt-in.
   */
  readonly tools?: ToolInvoker | undefined;
  /**
   * How many tools one decision may call.
   *
   * Enforced outside the agent, so it is a property of the runtime rather than
   * something an agent is trusted to respect.
   */
  readonly maxToolCallsPerDecision?: number | undefined;
  /** Ambient facts every agent sees. Per-request data travels on the task. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly logger?: Logger | undefined;
  readonly observer?: AgentObserver | undefined;
  /**
   * Where trace events go.
   *
   * Distinct from `observer`, and the difference is lifetime. `AgentObserver`
   * is a synchronous in-process stream with no identity: useful for watching,
   * useless afterwards. A trace has an id, survives the process and correlates
   * a decision with the execution it produced. Both are fed from the same
   * emission points, so there is one place where an event is decided on and
   * two shapes it can leave in.
   */
  readonly tracer?: TraceObserver | undefined;
  /**
   * Supplies the id for each trace.
   *
   * Injectable so a test can assert on a known id rather than on "some uuid".
   * Defaults to `crypto.randomUUID`, which is what makes ids unique without a
   * counter that would collide across processes.
   */
  readonly generateTraceId?: (() => string) | undefined;
  /** Injectable clock, for the same reason. */
  readonly now?: (() => Date) | undefined;
}

export class AgentRuntime implements AgentDecisionService {
  private readonly registry: InMemoryAgentRegistry;
  private readonly availableWorkflows: readonly string[];
  private readonly metadata: Readonly<Record<string, unknown>>;
  private readonly logger: Logger;
  private readonly tools: ToolInvoker | undefined;
  private readonly maxToolCalls: number;
  private readonly observer: AgentObserver;
  private readonly tracer: TraceObserver;
  private readonly generateTraceId: () => string;
  private readonly now: () => Date;

  public constructor(options: AgentRuntimeOptions) {
    this.registry = options.registry;
    this.availableWorkflows = [...options.availableWorkflows];
    // Frozen for the same reason the tool runtime freezes its own: the object
    // is shared across every decision, and `Readonly<>` is a type, not a lock.
    this.metadata = Object.freeze({ ...options.metadata });
    this.logger = options.logger ?? silentLogger;
    this.tools = options.tools;
    this.maxToolCalls =
      options.maxToolCallsPerDecision ?? DEFAULT_MAX_TOOL_CALLS_PER_DECISION;
    this.observer = options.observer ?? NOOP_AGENT_OBSERVER;
    this.tracer = options.tracer ?? NOOP_TRACE_OBSERVER;
    this.generateTraceId = options.generateTraceId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
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

    // The same narrowing, one layer down: permitted by the manifest *and*
    // installed. An agent is never shown a tool it could not call.
    const installedTools = this.tools?.installedToolIds() ?? [];
    const availableTools = manifest.allowedTools.filter((toolId) =>
      installedTools.includes(toolId),
    );

    // One id for the whole decision: the worker that was chosen, the agent
    // that decided, every tool it consulted, and — once a caller starts one —
    // the execution that resulted. Nothing else correlates those.
    const traceId = this.generateTraceId();
    const toolCalls: TraceToolCall[] = [];

    // Recorded as each call resolves rather than collected at the end, so a
    // decision that throws still leaves the tool calls it had already made.
    const onCall = (observed: ObservedToolCall): void => {
      toolCalls.push({
        toolId: observed.toolId,
        durationMs: observed.durationMs,
        status: observed.status,
        ...(observed.errorCode !== undefined ? { errorCode: observed.errorCode } : {}),
      });

      void this.trace({
        type: "tool.call.observed",
        traceId,
        toolId: observed.toolId,
        durationMs: observed.durationMs,
        status: observed.status,
        ...(observed.errorCode !== undefined ? { errorCode: observed.errorCode } : {}),
        timestamp: this.now().toISOString(),
      });
    };

    // Scoped to this decision, so the budget cannot be reset by anything the
    // agent does and cannot be carried over from a previous one.
    const toolService =
      this.tools === undefined || availableTools.length === 0
        ? EMPTY_TOOL_SERVICE
        : new AgentScopedToolService({
            invoker: this.tools,
            allowedTools: availableTools,
            maxCalls: this.maxToolCalls,
            agentId: manifest.id,
            workerId: validated.workerId,
            onCall,
            ...(signal !== undefined ? { signal } : {}),
          });

    const context: AgentContext = {
      availableWorkflows,
      availableTools,
      tools: toolService,
      metadata: this.metadata,
      // A context without a signal would leave an agent unable to observe
      // cancellation, so one is always present — unaborted when none is given.
      signal: signal ?? new AbortController().signal,
      logger: this.logger,
    };

    const startedAt = performance.now();

    this.emit({
      type: "agent.decision.started",
      agentId: manifest.id,
      workerId: validated.workerId,
      // The length, never the request. What is being observed is that a
      // decision happened and roughly how much it had to work with.
      requestLength: validated.request.length,
      availableWorkflows: [...availableWorkflows],
      availableTools: [...availableTools],
    });

    await this.trace({
      type: "agent.decision.started",
      traceId,
      workerId: validated.workerId,
      agentId: manifest.id,
      timestamp: this.now().toISOString(),
    });

    // Everything from here on is wrapped, so a refusal closes the trace it
    // opened. Stage 36 had no failure event at all: a decision rejected for
    // carrying private reasoning, or for naming a forbidden workflow, left a
    // started event and nothing else — the exact case anyone reading traces
    // would most want to find.
    try {
      const decision = this.parseDecision(
        manifest.id,
        await agent.decide(validated, context),
      );

      this.emit({
        type: "agent.decision.completed",
        agentId: manifest.id,
        workerId: validated.workerId,
        decision: decision.type,
        ...(decision.type === "run_workflow"
          ? { workflowId: decision.workflowId }
          : {}),
        toolCalls:
          toolService instanceof AgentScopedToolService ? toolService.callCount : 0,
        durationMs: Math.max(0, performance.now() - startedAt),
      });

      const result = this.enforce(
        manifest,
        validated,
        decision,
        traceId,
      );

      await this.trace({
        type: "agent.decision.completed",
        traceId,
        decisionType: decision.type,
        ...(decision.type === "run_workflow"
          ? { workflowId: decision.workflowId }
          : {}),
        durationMs: Math.max(0, performance.now() - startedAt),
        timestamp: this.now().toISOString(),
      });

      return result;
    } catch (error) {
      await this.trace({
        type: "agent.decision.failed",
        traceId,
        // A code, never the message. `ERR_AGENT_DECISION_INVALID` is raised
        // when an agent attached private reasoning; recording the message
        // would record that reasoning.
        errorCode: error instanceof DesignFlowError ? error.code : "ERR_AGENT_DECISION_FAILED",
        durationMs: Math.max(0, performance.now() - startedAt),
        timestamp: this.now().toISOString(),
      });

      throw error;
    }
  }

  /**
   * The allow-list checks, and the result they guard.
   *
   * Extracted so the trace wrapper above reads as one shape: try, close the
   * trace, or close it as failed. Nothing here changed from Stage 36 — a
   * decision still faces both lists, and tool use buys no exemption.
   */
  private enforce(
    manifest: AgentManifest,
    task: AgentTask,
    decision: AgentDecision,
    traceId: string,
  ): AgentExecutionResult {
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
      workerId: task.workerId,
      decision,
      traceId,
    });
  }

  /**
   * Sends a trace event, and never lets it fail the decision.
   *
   * Awaited rather than fired and forgotten: the durable observer writes to
   * disk, and a CLI process exits the moment a decision resolves, so an
   * un-awaited write would simply be lost. Wrapped, because tracing that could
   * break the thing it traces would be worse than no tracing.
   */
  private async trace(event: TraceEvent): Promise<void> {
    try {
      await this.tracer.onEvent(event);
    } catch {
      // Deliberately swallowed. A broken or full trace store must not stop
      // someone running a workflow.
    }
  }

  /** Observation must never be able to break the decision it is watching. */
  private emit(observation: AgentObservation): void {
    try {
      this.observer.observe(observation);
    } catch {
      // Deliberately swallowed, for the same reason the tool runtime does:
      // failing a decision over a broken observer would make adding
      // observability riskier than going without.
    }
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
