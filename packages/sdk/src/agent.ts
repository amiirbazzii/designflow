// packages/sdk/src/agent.ts
import { z } from "zod";
import type { Logger } from "./context";
import type { WorkerManifest } from "./worker-manifest";

/**
 * An Agent is a bounded decision-maker.
 *
 * It sits between the worker a person chose and the workflow that does the
 * work. Given a request it answers exactly one question — "what should happen
 * next?" — and the answer is one of three things: run a permitted workflow, ask
 * for something missing, or decline.
 *
 * What an agent deliberately is **not** is a second execution engine. It does
 * not run steps, order them, retry them, produce artifacts or observe results.
 * The workflow engine remains the execution authority; an agent only selects
 * from a list the engine already knows how to run. That boundary is why the
 * decision is a *value* rather than a callback: a value can be validated,
 * logged and refused before anything executes.
 *
 * Everything future stages want from agents — tools, memory, project context,
 * LLM-backed reasoning, evaluation of intermediate results — changes *how* the
 * decision is reached, not what a decision is. Those all fit behind `decide`.
 */

// ── Manifest ────────────────────────────────────────────────────

/**
 * What an agent declares about itself.
 *
 * Strict, because an agent manifest is an allow-list: a typo in
 * `allowedWorkflows` that silently landed in an unread extra key would widen
 * what the agent may do without anyone noticing.
 */
export const agentManifestSchema = z
  .object({
    /** Stable identifier. Referenced by `WorkerManifest.agentId`. */
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    /**
     * Explicit rather than defaulted.
     *
     * An agent's behaviour is the product, and the product is refined over
     * time; a decision recorded without knowing which version produced it
     * cannot be explained later.
     */
    version: z.string().min(1),
    /**
     * The standing brief — what this agent is for, in words.
     *
     * Inert in this stage: nothing reads it at runtime. It is carried now
     * because it is part of the manifest's identity, and an agent whose
     * instructions arrived later would have a version history that skips the
     * only field describing what it was asked to do.
     */
    instructions: z.string().min(1),
    /**
     * The only workflows this agent may choose.
     *
     * The core safety property of the whole design. An agent cannot reach a
     * workflow it did not declare, so the blast radius of a wrong — or
     * manipulated — decision is bounded by a list a human wrote and reviewed.
     * At least one, because an agent permitted to run nothing can only ever
     * decline.
     */
    allowedWorkflows: z
      .array(z.string().min(1))
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "allowedWorkflows must not repeat a workflow id",
      }),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentManifest = z.infer<typeof agentManifestSchema>;

// ── Task ────────────────────────────────────────────────────────

/**
 * A bounded request to an agent.
 *
 * Bounded in both directions: it names the worker the person chose and the
 * agent that worker delegates to, so a task cannot be replayed against a
 * different agent than the one the catalogue put in front of the user.
 */
export const agentTaskSchema = z
  .object({
    workerId: z.string().min(1),
    agentId: z.string().min(1),
    /**
     * What the person asked for.
     *
     * Not `.min(1)` on purpose. An empty request is a *decidable* situation —
     * the right answer is to ask a clarifying question — and rejecting it as a
     * malformed task would turn a conversation into an error.
     */
    request: z.string(),
    /** The structured answers collected alongside the request, if any. */
    input: z.unknown().optional(),
    /** Per-request facts. Ambient installation facts live on `AgentContext`. */
    context: z.record(z.unknown()).optional(),
  })
  .strict();

export type AgentTask = z.infer<typeof agentTaskSchema>;

// ── Decision ────────────────────────────────────────────────────

/**
 * A concise, user-safe explanation.
 *
 * Explicitly **not** chain-of-thought. The distinction is enforced rather than
 * documented: every decision member below is `.strict()`, so an agent that
 * attaches its private reasoning under any other key produces a decision that
 * fails to parse instead of one that quietly carries it into a transcript,
 * a log line or a terminal.
 */
const reasoningSummary = z.string().min(1).optional();

export const agentDecisionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("run_workflow"),
      workflowId: z.string().min(1),
      /**
       * What to run the workflow with.
       *
       * Optional: an agent that only chose *which* workflow leaves the
       * caller's own input alone rather than replacing it with nothing.
       */
      input: z.unknown().optional(),
      reasoningSummary,
    })
    .strict(),
  z
    .object({
      type: z.literal("request_clarification"),
      question: z.string().min(1),
      reasoningSummary,
    })
    .strict(),
  z
    .object({
      type: z.literal("decline"),
      reason: z.string().min(1),
      reasoningSummary,
    })
    .strict(),
]);

export type AgentDecision = z.infer<typeof agentDecisionSchema>;

/** The decision plus who made it, which is what a caller records. */
export const agentExecutionResultSchema = z
  .object({
    agentId: z.string().min(1),
    workerId: z.string().min(1),
    decision: agentDecisionSchema,
  })
  .strict();

export type AgentExecutionResult = z.infer<typeof agentExecutionResultSchema>;

// ── Runtime contracts ───────────────────────────────────────────

/**
 * What an agent is allowed to see while deciding.
 *
 * Deliberately narrow. No repositories, no artifact store, no execution
 * service, no workflow definitions — an agent that could reach those could act
 * instead of decide, and the boundary would exist only in the documentation.
 */
export interface AgentContext {
  /**
   * The workflows this agent may actually pick right now.
   *
   * Already narrowed to what the manifest permits *and* the host has
   * installed, so an agent choosing from this list cannot produce a decision
   * the runtime will then refuse.
   */
  readonly availableWorkflows: readonly string[];
  /** Ambient installation facts. Per-request data travels on the task. */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  readonly logger: Logger;
}

export interface Agent {
  readonly manifest: AgentManifest;

  decide(task: AgentTask, context: AgentContext): Promise<AgentDecision>;
}

/**
 * The port a product surface uses to reach agents.
 *
 * Exists so the product layer can route a task without importing an agent
 * implementation — the same reason `WorkerRegistry` is declared here and
 * implemented elsewhere. `AgentRuntime` is the implementation.
 */
export interface AgentDecisionService {
  decide(task: AgentTask, signal?: AbortSignal): Promise<AgentExecutionResult>;
}

// ── Worker/agent alignment ──────────────────────────────────────

/**
 * The workflows a worker advertises that its agent may not run.
 *
 * A worker is a promise in a catalogue and an agent's allow-list is what can
 * be delivered on. When they disagree the catalogue offers work that will only
 * ever be declined — a configuration mistake worth catching when the two are
 * wired together, not on the run that hits it.
 *
 * Pure, and returns the offenders rather than a boolean, so the caller can say
 * which workflow was the problem.
 */
export function workerAgentWorkflowMismatch(
  worker: WorkerManifest,
  agent: AgentManifest,
): readonly string[] {
  const allowed = new Set(agent.allowedWorkflows);
  return worker.workflows.filter((workflowId) => !allowed.has(workflowId));
}
