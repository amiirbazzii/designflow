// packages/sdk/src/worker-manifest.ts
import { z } from "zod";
import { workerEvaluationCriterionSchema } from "./worker-evaluation";

/**
 * A Worker is a product-facing identity that wraps one or more workflows.
 *
 * The vocabulary a person uses. "Design Engineer" is something you can hire;
 * "design-to-code" is a pipeline. The worker is what appears in a catalog, and
 * the workflow is how the work gets done.
 *
 * Deliberately **metadata only** — no execution logic, no engine imports, no
 * behaviour. A worker names workflows; it does not run, replace or wrap them at
 * runtime. Deleting the worker layer would leave every workflow working
 * exactly as before, which is the test of whether this stayed a naming layer.
 *
 * The schema lives beside `workflowManifestSchema` because it is the same kind
 * of thing one level up: a public contract describing installable metadata.
 */

/** A field a worker needs before it can start. */
export const workerInputFieldSchema = z.object({
  key: z.string().min(1),
  /** Shown to a person, e.g. "Design file". */
  label: z.string().min(1),
  /** Used as the example, and as the value when the field is left blank. */
  placeholder: z.string().min(1),
  /** Split the answer on commas into a list. */
  list: z.boolean().optional(),
  /** Restricts the answer to a fixed set. */
  choices: z.array(z.string().min(1)).optional(),
});

export type WorkerInputField = z.infer<typeof workerInputFieldSchema>;

export const workerManifestSchema = z.object({
  /** Stable identifier, used as `designflow run <id>`. */
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  /**
   * Free-form rather than an enum, so a third-party worker can categorise
   * itself without a change here.
   */
  category: z.string().min(1),
  /**
   * The workflows this worker is built from, entry point first.
   *
   * A worker must name at least one — a worker that runs nothing is a
   * catalogue entry for work that cannot happen.
   */
  workflows: z.array(z.string().min(1)).min(1),
  /**
   * What to ask for before starting.
   *
   * Carried here so a consumer can generate an input form from the catalogue
   * rather than hardcoding one per worker. Optional: a worker that needs no
   * input declares none.
   */
  inputs: z.array(workerInputFieldSchema).default([]),
  /**
   * The agent this worker delegates its decision to, if it has one.
   *
   * Optional, and additive on purpose. A worker without it resolves exactly as
   * it always did — `workflows[0]`, no agent involved — so every manifest
   * written before agents existed keeps working unchanged. A worker with it
   * asks its agent which of `workflows` to run instead of assuming the first.
   *
   * `workflows` stays required either way. It is what the catalogue advertises
   * and what `workerAgentWorkflowMismatch` checks the agent against; a worker
   * that named only an agent would be a promise nobody could verify.
   */
  agentId: z.string().min(1).optional(),
  /**
   * What "good" means for this worker's result.
   *
   * Typed product metadata, not an evaluation engine — declaring a criterion
   * here does not run it. Optional and additive, so every manifest written
   * before Stage 41 keeps parsing unchanged.
   */
  evaluationCriteria: z.array(workerEvaluationCriterionSchema).default([]),
  /**
   * The project facts and memory notes this worker draws on, named for
   * display and documentation — not an access grant. Stage 40's scoping
   * (`MemoryScope`, `ProjectContextService`) is what actually enforces
   * isolation; this is descriptive metadata a settings/help surface can show
   * ("Design Engineer uses: framework, design-system path").
   */
  projectContext: z
    .object({
      relevantFacts: z.array(z.string().min(1)).default([]),
      relevantMemory: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  metadata: z
    .object({
      author: z.string().optional(),
      tags: z.array(z.string()).default([]),
    })
    .optional(),
});

export type WorkerManifest = z.infer<typeof workerManifestSchema>;

/**
 * The source of truth for which workers an installation offers.
 *
 * Synchronous: a catalogue is in-process metadata, and making it async would
 * force every caller to await a lookup that never waits on anything.
 */
export interface WorkerRegistry {
  listWorkers(): readonly WorkerManifest[];
  getWorker(id: string): WorkerManifest | undefined;
  registerWorker(manifest: WorkerManifest): void;
}

/**
 * The workflow a worker starts with.
 *
 * First in `workflows` is the entry point. Workers with several workflows have
 * no routing rule yet — when they do, this is the function that gains it, and
 * callers do not change.
 */
export function primaryWorkflowOf(manifest: WorkerManifest): string {
  const first = manifest.workflows[0];

  // `workflows` is `.min(1)`, so this is unreachable for a parsed manifest.
  // Guarded rather than asserted, because a hand-built object can skip Zod.
  if (first === undefined) {
    throw new Error(`Worker ${manifest.id} names no workflow`);
  }

  return first;
}
