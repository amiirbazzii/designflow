import { z } from "zod";
import { artifactRefSchema } from "./schemas";
import type { ArtifactRef } from "./schemas";

// ── Reconciliation Input ─────────────────────────────────────────

/**
 * The three artifact sets an incremental run produces, before they are merged.
 *
 * `previousArtifacts` is the prior run's final set. It is read for
 * classification only — an artifact does not survive into the result by
 * appearing here, it survives by being reused or produced.
 */
export const artifactReconciliationInputSchema = z.object({
  executionId: z.string().min(1),
  previousArtifacts: z.array(artifactRefSchema).default([]),
  /** Adopted in place of running a node. */
  reusedArtifacts: z.array(artifactRefSchema).default([]),
  /** Emitted by a node that actually ran. */
  producedArtifacts: z.array(artifactRefSchema).default([]),
});

export type ArtifactReconciliationInput = z.infer<
  typeof artifactReconciliationInputSchema
>;

// ── Reconciliation Result ────────────────────────────────────────

export const artifactReconciliationResultSchema = z.object({
  executionId: z.string().min(1),
  /** The run's final artifact set: everything reused plus everything produced. */
  artifacts: z.array(artifactRefSchema).default([]),
  reusedArtifactIds: z.array(z.string().min(1)).default([]),
  producedArtifactIds: z.array(z.string().min(1)).default([]),
  /** Ids the previous run had that this run's set no longer carries. */
  removedArtifactIds: z.array(z.string().min(1)).default([]),
});

export type ArtifactReconciliationResult = z.infer<
  typeof artifactReconciliationResultSchema
>;

// ── Reconciliation Report ────────────────────────────────────────

/**
 * A count of what changed between two runs.
 *
 * `added`, `reused` and `unchanged` partition the result set; `removed`
 * counts ids that left it. An artifact adopted from the previous run counts as
 * `reused`, not `unchanged` — `unchanged` is for an artifact whose identity
 * survived without being reused, which happens when a node ran again and
 * produced the same version.
 */
export const reconciliationReportSchema = z.object({
  executionId: z.string().min(1),
  added: z.number().int().nonnegative(),
  reused: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});

export type ReconciliationReport = z.infer<typeof reconciliationReportSchema>;

// ── Reconciler Contract ──────────────────────────────────────────

/**
 * Merges an incremental run's artifact sets into one consistent result.
 *
 * Reconciliation merges, verifies completeness and preserves lineage. It never
 * executes a capability, decides reuse, plans execution, or mutates artifact
 * contents — it is the last read-only step of the incremental loop:
 *
 * | Question | Owner |
 * |---|---|
 * | Does this node need computation? | `IncrementalExecutionPlanner` |
 * | Can we reuse instead of computing? | `CapabilityReuseResolver` |
 * | Are these artifacts real and usable? | `ArtifactMaterializer` |
 * | What is this run's final artifact set? | `ExecutionReconciler` |
 */
export interface ExecutionReconciler {
  reconcile(
    input: ArtifactReconciliationInput,
  ): Promise<ArtifactReconciliationResult>;

  createReport(
    previous: readonly ArtifactRef[],
    result: ArtifactReconciliationResult,
  ): Promise<ReconciliationReport>;
}
