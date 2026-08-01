// packages/sdk/src/worker-evaluation-helpers.ts
import type { WorkerEvaluationResult } from "./worker-result";

/**
 * Generic infrastructure for a worker's first deterministic evaluation
 * layer.
 *
 * This module owns only the shared vocabulary and helpers — not a single
 * per-worker check. Each workflow package owns the criteria for its own
 * artifacts (it is the only package that can safely import its own Zod
 * schemas), and `@designflow/product` owns generic aggregation
 * (`requiredSatisfied`/`requiredTotal` across a worker's criteria). This file
 * is what lets both sides speak the same shapes without either depending on
 * the other's concrete schemas.
 */

/**
 * The minimal artifact shape a deterministic worker evaluator needs: enough
 * to check presence and status, nothing about how a caller's read model
 * represents an artifact beyond that.
 */
export interface EvaluableArtifact {
  readonly artifactId: string;
  readonly status: string;
}

/** Resolves an artifact's payload by its logical id, when available. */
export type ArtifactPayloadReader = (artifactId: string) => unknown;

/**
 * One worker's deterministic per-criterion evaluator: given a criterion id,
 * the worker's artifact list, and a payload reader, decides whether that
 * criterion is satisfied (or reports that it cannot be decided
 * deterministically).
 */
export type WorkerCriterionEvaluator = (
  criterionId: string,
  artifacts: readonly EvaluableArtifact[],
  getArtifactPayload: ArtifactPayloadReader | undefined,
) => WorkerEvaluationResult;

export function isPresent(artifacts: readonly EvaluableArtifact[], artifactId: string): boolean {
  return artifacts.some((artifact) => artifact.artifactId === artifactId && artifact.status !== "removed");
}

export function payloadOf(
  artifacts: readonly EvaluableArtifact[],
  artifactId: string,
  getArtifactPayload: ArtifactPayloadReader | undefined,
): unknown {
  if (!isPresent(artifacts, artifactId)) return undefined;
  return getArtifactPayload?.(artifactId);
}

export function cannotDecide(criterionId: string, note: string): WorkerEvaluationResult {
  return { criterionId, satisfied: undefined, note };
}

export function decided(criterionId: string, satisfied: boolean, note?: string): WorkerEvaluationResult {
  return note !== undefined
    ? { criterionId, satisfied, value: satisfied, note }
    : { criterionId, satisfied, value: satisfied };
}
