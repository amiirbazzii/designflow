// packages/product/src/worker-evaluation-service.ts
import type {
  ArtifactPayloadReader,
  WorkerCriterionEvaluator,
  WorkerEvaluationResult,
  WorkerEvaluationSummary,
  WorkerManifest,
} from "@designflow/sdk";
import type { ArtifactSummary, ExecutionOverview } from "./schemas";

/**
 * The generic aggregation half of a worker's first deterministic evaluation
 * layer.
 *
 * This module owns no criterion logic of its own — every concrete check
 * (what "output-validates" means for the Design Engineer, what "findings
 * have severity" means for the QA Reviewer, and so on) lives in the workflow
 * package that owns the relevant artifact's schema, since only that package
 * can safely import it without creating a `product -> workflow-* -> product`
 * cycle. The composition root supplies those evaluators here, keyed by
 * worker id, through the `evaluators` parameter.
 *
 * What stays here is generic: running the right evaluator (if any) for each
 * of a worker's declared criteria, and rolling the per-criterion results up
 * into a `requiredSatisfied`/`requiredTotal` summary.
 */

function cannotDecide(criterionId: string, note: string): WorkerEvaluationResult {
  return { criterionId, satisfied: undefined, note };
}

/**
 * Computes a `WorkerEvaluationSummary` for one worker's result, deterministically.
 *
 * Pure: given the same worker manifest, artifact list, overview, evaluator
 * registry and payload reader, this always returns the same summary. No
 * criterion here is ever decided by a model or a network call — a criterion
 * that cannot be decided from the data on hand is reported as
 * `satisfied: undefined` with an explanatory `note`, never silently skipped
 * and never guessed at.
 */
export function evaluateWorkerResult(
  worker: WorkerManifest,
  artifacts: readonly ArtifactSummary[],
  overview: ExecutionOverview,
  evaluators: Record<string, WorkerCriterionEvaluator>,
  getArtifactPayload?: ArtifactPayloadReader,
): WorkerEvaluationSummary {
  const evaluate = evaluators[worker.id];

  const results: WorkerEvaluationResult[] = worker.evaluationCriteria.map((criterion) => {
    if (overview.state !== "ready") {
      return cannotDecide(criterion.id, `The execution did not complete (state: ${overview.state})`);
    }

    if (evaluate === undefined) {
      return cannotDecide(criterion.id, `No deterministic evaluator is implemented for worker "${worker.id}"`);
    }

    return evaluate(criterion.id, artifacts, getArtifactPayload);
  });

  const requiredCriteria = worker.evaluationCriteria.filter((criterion) => criterion.required);
  const resultsById = new Map(results.map((result) => [result.criterionId, result]));

  const requiredSatisfied = requiredCriteria.filter(
    (criterion) => resultsById.get(criterion.id)?.satisfied === true,
  ).length;

  return {
    results,
    requiredSatisfied,
    requiredTotal: requiredCriteria.length,
  };
}
