// packages/product/src/worker-task.ts
import {
  DesignFlowError,
  primaryWorkflowOf,
  type AgentDecision,
  type AgentDecisionService,
  type WorkerManifest,
  type WorkerRegistry,
} from "@designflow/sdk";

import { z } from "zod";

/**
 * The product boundary between a person choosing a worker and something
 * running.
 *
 * One question in — "this worker, this request" — and one decision out. The
 * caller does not learn whether an agent was involved, and could not act
 * differently if it did: legacy workers and agent-backed workers both come
 * back as an `AgentDecision`, so a surface renders one shape either way.
 *
 * That uniformity is the point. It is what lets the CLI stay ignorant of which
 * workflow gets picked and of the fact that agents exist at all — the property
 * that would quietly rot if the router returned a workflow id for legacy
 * workers and a decision for agent-backed ones.
 *
 * Lives in the product layer rather than in the engine because it is
 * orchestration of *product* concepts. The engine does not know workers exist,
 * and after this stage it still does not know agents do.
 */

export const workerTaskRequestSchema = z
  .object({
    workerId: z.string().min(1),
    /**
     * What the person asked for, in their words.
     *
     * Permitted to be empty. An agent answers an empty request by asking a
     * question, and rejecting it here would take that answer away.
     */
    request: z.string().default(""),
    input: z.unknown().optional(),
    /**
     * Bounded per-request facts, forwarded to `AgentTask.context` unchanged.
     *
     * Additive: absent by default, and a caller that never sets it — every
     * caller before Stage 39 — behaves exactly as before. Stage 39 uses it to
     * carry a resumed session's clarification history; nothing about that is
     * specific to sessions, so the field is named for what it is rather than
     * for the one caller that populates it today.
     */
    context: z.record(z.unknown()).optional(),
  })
  .strict();

export type WorkerTaskRequest = z.infer<typeof workerTaskRequestSchema>;

export interface WorkerTaskResult {
  readonly worker: WorkerManifest;
  readonly decision: AgentDecision;
  /**
   * The trace this decision was recorded under, when an agent made it.
   *
   * Absent for a legacy worker, because no decision was made — the mapping was
   * a lookup, and there is nothing to explain.
   */
  readonly traceId?: string | undefined;
}

/**
 * Shares `ERR_WORKER_NOT_FOUND` with the catalogue's own error.
 *
 * The code is the contract, not the class. The product layer depends on
 * `@designflow/sdk` alone, so it cannot throw the catalogue's class — but a
 * caller matching on the code must not have to care which layer refused.
 */
export class UnknownWorkerError extends DesignFlowError {
  public constructor(workerId: string) {
    super("ERR_WORKER_NOT_FOUND", `No such worker: ${workerId}`, { workerId });
    this.name = "UnknownWorkerError";
    Object.setPrototypeOf(this, UnknownWorkerError.prototype);
  }
}

/**
 * An agent-backed worker was routed with no agent runtime wired in.
 *
 * Refused rather than quietly falling back to `workflows[0]`. The fallback
 * would look like it worked while skipping the layer the worker asked for —
 * and skipping an agent means skipping its allow-list.
 */
export class AgentRuntimeUnavailableError extends DesignFlowError {
  public constructor(workerId: string, agentId: string) {
    super(
      "ERR_AGENT_RUNTIME_UNAVAILABLE",
      `Worker ${workerId} delegates to agent ${agentId}, but no agent runtime is configured`,
      { workerId, agentId },
    );
    this.name = "AgentRuntimeUnavailableError";
    Object.setPrototypeOf(this, AgentRuntimeUnavailableError.prototype);
  }
}

export interface WorkerTaskRouterOptions {
  readonly workers: WorkerRegistry;
  /**
   * Optional, so a host with no agents installed still routes.
   *
   * Typed as the SDK port rather than `AgentRuntime`, which is what keeps this
   * package's dependency on `@designflow/sdk` alone true.
   */
  readonly agents?: AgentDecisionService | undefined;
}

export class WorkerTaskRouter {
  private readonly workers: WorkerRegistry;
  private readonly agents: AgentDecisionService | undefined;

  public constructor(options: WorkerTaskRouterOptions) {
    this.workers = options.workers;
    this.agents = options.agents;
  }

  /** Routes by id, resolving the worker through the catalogue. */
  public async route(
    request: WorkerTaskRequest,
    signal?: AbortSignal,
  ): Promise<WorkerTaskResult> {
    const validated = workerTaskRequestSchema.parse(request);
    const worker = this.workers.getWorker(validated.workerId);

    if (worker === undefined) {
      throw new UnknownWorkerError(validated.workerId);
    }

    return this.routeWorker(worker, validated, signal);
  }

  /**
   * Routes a worker the caller already holds.
   *
   * For surfaces that resolve a name themselves before routing it — the CLI
   * accepts a workflow id as well as a worker id, and synthesises a manifest
   * for a workflow no worker owns. Such a manifest is a valid legacy worker
   * but is in no catalogue, so a lookup by id would refuse work that is
   * legitimately reachable.
   */
  public async routeWorker(
    worker: WorkerManifest,
    request: WorkerTaskRequest,
    signal?: AbortSignal,
  ): Promise<WorkerTaskResult> {
    const validated = workerTaskRequestSchema.parse(request);
    const { agentId } = worker;

    // Legacy: the mapping this layer has always performed, now expressed as a
    // decision so both paths return one shape. No agent is consulted, and a
    // manifest written before agents existed reaches exactly the workflow it
    // always did.
    if (agentId === undefined) {
      // Deterministic product clarification (V2-8): a required input the
      // manifest declares must be present before the workflow starts. This is
      // product state, never a model call — the same question the Coordinator
      // used to spend an LLM invocation discovering.
      const input = (validated.input ?? {}) as Record<string, unknown>;
      const missing = worker.inputs.find((field) => {
        if (field.required !== true) return false;
        const value = input[field.key];
        if (value === undefined || value === null) return true;
        if (typeof value === "string") return value.trim().length === 0;
        if (Array.isArray(value)) return value.length === 0;
        return false;
      });
      if (missing !== undefined) {
        return {
          worker,
          decision: {
            type: "request_clarification",
            question: `${missing.label} (${missing.placeholder})`,
          },
        };
      }

      return {
        worker,
        decision: {
          type: "run_workflow",
          workflowId: primaryWorkflowOf(worker),
          ...(validated.input !== undefined ? { input: validated.input } : {}),
        },
      };
    }

    if (this.agents === undefined) {
      throw new AgentRuntimeUnavailableError(worker.id, agentId);
    }

    const result = await this.agents.decide(
      {
        workerId: worker.id,
        agentId,
        request: validated.request,
        ...(validated.input !== undefined ? { input: validated.input } : {}),
        ...(validated.context !== undefined ? { context: validated.context } : {}),
      },
      signal,
    );

    return {
      worker,
      decision: result.decision,
      ...(result.traceId !== undefined ? { traceId: result.traceId } : {}),
    };
  }
}
