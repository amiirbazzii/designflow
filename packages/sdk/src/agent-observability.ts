// packages/sdk/src/agent-observability.ts
import { z } from "zod";

/**
 * What happened while an agent decided.
 *
 * A separate stream from the engine's execution events, and deliberately not
 * merged into it. The engine's event stream is the audit trail of *work*: it
 * is replayed, reconciled and used to reconstruct what a run produced. Agent
 * deliberation is not work — it produces no artifact, changes no state, and a
 * decision that ended in `decline` has no execution to attach to. Putting
 * these there would mean the engine had to know agents exist, and would put
 * events on a stream whose consumers assume every entry belongs to a run.
 *
 * So this is a product-level stream with a no-op default. Nothing persists it
 * in this stage; it exists because the moment an agent's reasoning is a model
 * call rather than an if-statement, "why did it pick that?" becomes the first
 * question asked, and there would otherwise be no answer.
 *
 * **Nothing here carries private reasoning, raw input or raw output.** Only
 * shapes, codes, durations and counts. That is not a convention — the schemas
 * are strict and there is no field to put them in.
 */

/** Top-level keys of an object payload. Never the values. */
const shapeKeys = z.array(z.string()).default([]);

export const agentObservationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("agent.decision.started"),
      agentId: z.string().min(1),
      workerId: z.string().min(1),
      /** How many characters the request was. Never the request itself. */
      requestLength: z.number().int().nonnegative(),
      availableWorkflows: z.array(z.string()).default([]),
      availableTools: z.array(z.string()).default([]),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.call.started"),
      callId: z.string().min(1),
      toolId: z.string().min(1),
      agentId: z.string().optional(),
      workerId: z.string().optional(),
      /** The shape of the input, so a mismatch is diagnosable. Not the data. */
      inputKeys: shapeKeys,
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.call.completed"),
      callId: z.string().min(1),
      toolId: z.string().min(1),
      durationMs: z.number().nonnegative(),
      outputKeys: shapeKeys,
    })
    .strict(),
  z
    .object({
      type: z.literal("tool.call.failed"),
      callId: z.string().min(1),
      toolId: z.string().min(1),
      code: z.string().min(1),
      /** Already sanitised and truncated by the runtime. Never a stack. */
      message: z.string().min(1),
      retryable: z.boolean(),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent.decision.completed"),
      agentId: z.string().min(1),
      workerId: z.string().min(1),
      /** Which of the three answers, not why. */
      decision: z.enum(["run_workflow", "request_clarification", "decline"]),
      /** The chosen workflow, when one was chosen. */
      workflowId: z.string().optional(),
      toolCalls: z.number().int().nonnegative(),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
]);

export type AgentObservation = z.infer<typeof agentObservationSchema>;

/**
 * Somewhere for observations to go.
 *
 * Synchronous and returning void, so observing cannot fail a decision, cannot
 * slow one down by awaiting, and cannot change what an agent decides. An
 * observer that throws would otherwise be able to break the very path it is
 * meant to be watching — so the emitting side swallows observer errors, which
 * is the one place in this codebase where swallowing is correct.
 */
export interface AgentObserver {
  observe(observation: AgentObservation): void;
}

/** The default. Observability is opt-in. */
export const NOOP_AGENT_OBSERVER: AgentObserver = { observe: () => {} };

/** Top-level keys of a value, when it is a plain object. */
export function shapeOf(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  return Object.keys(value);
}
