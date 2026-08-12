// packages/sdk/src/agent-invocation.ts
import { z } from "zod";
import type { Logger } from "./context";
import type { AgentManifest } from "./agent";
import type { AgentModelService } from "./model";
import type { AgentToolService } from "./tool";
import type { TraceEvidenceMetrics } from "./trace";

/**
 * A Specialized Agent is invoked *by a workflow node*, not by a person's
 * request. Where `Agent.decide` answers "what should happen next?" with one
 * of three fixed outcomes, a specialized agent answers "produce this typed
 * artifact" — a design specification, an implementation, a validation
 * report. The shape of what it returns differs per agent, so unlike
 * `AgentDecision` there is no single shared output schema here; each
 * specialized agent validates its own output against its own contract (see
 * `@designflow/sdk`'s design-engineer contracts) before this ever returns.
 *
 * The boundary this file draws is deliberately the same one `agent.ts` draws
 * for the coordinator: a workflow node — never the agent itself, and never
 * another agent — decides when this runs. Nothing here lets one specialized
 * agent call another; `SpecializedAgentContext` carries no invocation port at
 * all, only the tool and model access this one agent was itself granted.
 */

export const agentInvocationRequestSchema = z
  .object({
    /** The specialized agent to invoke. Resolved through its own registry. */
    agentId: z.string().min(1),
    /** What this invocation is for, in words — carried for provenance and prompts. */
    objective: z.string().min(1),
    /** The typed input this agent's own contract expects. Validated by the agent. */
    input: z.unknown(),
    /** Which attempt this is, for an agent whose output may be revised. Starts at 1. */
    attempt: z.number().int().positive().default(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentInvocationRequest = z.infer<typeof agentInvocationRequestSchema>;

/**
 * The outcome of one invocation, as the invocation layer hands it back.
 *
 * A discriminated union, mirroring `ModelResult`/`ToolResult`: a caller
 * cannot read `output` without having established the call actually
 * succeeded, and a failure carries a stable code rather than a provider's or
 * an agent's own error text.
 */
export const agentInvocationOutcomeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("success"),
      agentId: z.string().min(1),
      /** The manifest version that produced this output — folds into reuse identity. */
      agentVersion: z.string().min(1),
      /** The model profile actually used, when this agent decided with one. */
      modelProfileId: z.string().min(1).optional(),
      output: z.unknown(),
      attempt: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failure"),
      agentId: z.string().min(1),
      /** A stable `ERR_*` code. Never matched on message text. */
      code: z.string().min(1),
      message: z.string().min(1),
      attempt: z.number().int().positive(),
    })
    .strict(),
]);

export type AgentInvocationOutcome = z.infer<typeof agentInvocationOutcomeSchema>;

/**
 * What a specialized agent is allowed to see while it performs one
 * invocation.
 *
 * Deliberately the same shape of restriction `AgentContext` applies to the
 * coordinator: a tool port and a model port, both already scoped and
 * budgeted by whoever built them, ambient metadata, a signal, a logger.
 * No workflow list, because a specialized agent never chooses a workflow —
 * it produces a value and returns. No invocation port, so it cannot reach
 * another agent.
 */
export interface SpecializedAgentContext {
  readonly tools: AgentToolService;
  readonly model: AgentModelService;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly logger: Logger;
  /**
   * Reports how much evidence an agent compiled into its model request.
   *
   * Counts and byte sizes only — never the prompt, the evidence itself or any
   * model response. Optional so a host that predates it (or a test double)
   * stays valid; an agent calls it at most once per invocation.
   */
  readonly reportEvidenceMetrics?: (metrics: TraceEvidenceMetrics) => void;
}

/**
 * An agent invoked for its output rather than for a routing decision.
 *
 * `perform` returns `unknown` rather than a generic `TOutput`, for the same
 * reason `AgentModelRequest.generate` does: the agent itself is the one that
 * knows and validates its own contract (the Zod schema for its output lives
 * next to the agent, not on this interface), and threading a type parameter
 * through here would need an unsafe cast to bridge a model's or a
 * deterministic strategy's raw result into it before validation has actually
 * happened.
 */
export interface SpecializedAgent {
  readonly manifest: AgentManifest;
  perform(
    request: AgentInvocationRequest,
    context: SpecializedAgentContext,
  ): Promise<unknown>;
}

/**
 * The port a workflow capability uses to reach the invocation layer.
 *
 * Exists so `CapabilityContext` can offer agent access while the workflow
 * package that consumes it still depends on `@designflow/sdk` alone —
 * `AgentInvocationRuntime` (in `@designflow/agents`) implements this, and only
 * a composition root ever constructs one. A workflow capability that never
 * received this port (every capability the SDK ships until this stage) is
 * unaffected: the field is optional on `CapabilityContext`, and a capability
 * that never reads it behaves exactly as it always did.
 */
export interface AgentInvocationService {
  invoke(
    request: AgentInvocationRequest,
    signal?: AbortSignal,
  ): Promise<AgentInvocationOutcome>;
}
