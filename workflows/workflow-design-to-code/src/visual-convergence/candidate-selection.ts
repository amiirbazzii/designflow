// workflows/workflow-design-to-code/src/visual-convergence/candidate-selection.ts
//
// Which evaluated state goes forward to approval.
//
// Not "the last one". A repair can fix the finding it was asked about and
// silently lose the bottom navigation; a loop that always ships its newest
// output rewards that. Selection is an explicit lexicographic policy over
// measured quality — no opaque score, no model opinion — and only proposals
// that passed every validation gate and actually rendered are candidates.
//
// SELECTION POLICY v1, compared in order, lower is better at every step:
//   1. renderable                      (non-renderable states are not candidates)
//   2. missingRequiredCount            (a screen missing required elements loses)
//   3. criticalCount
//   4. majorCount
//   5. unresolvedExpectationCount      (what the run could not even identify)
//   6. pixelMismatchRatio              (only when both candidates have one)
//   7. actionableCount
//   8. later iteration wins the tie    (the only place recency matters)
import type { ConvergenceIteration } from "@designflow/sdk";

export const SELECTION_POLICY_VERSION = "1";

/** Below this, two pixel ratios are the same for selection purposes. */
const PIXEL_RATIO_EPSILON = 0.005;

function compare(left: ConvergenceIteration, right: ConvergenceIteration): number {
  const a = left.quality;
  const b = right.quality;

  if (a.missingRequiredCount !== b.missingRequiredCount) return a.missingRequiredCount - b.missingRequiredCount;
  if (a.criticalCount !== b.criticalCount) return a.criticalCount - b.criticalCount;
  if (a.majorCount !== b.majorCount) return a.majorCount - b.majorCount;
  if (a.unresolvedExpectationCount !== b.unresolvedExpectationCount)
    return a.unresolvedExpectationCount - b.unresolvedExpectationCount;

  if (
    a.pixelMismatchRatio !== undefined &&
    b.pixelMismatchRatio !== undefined &&
    Math.abs(a.pixelMismatchRatio - b.pixelMismatchRatio) > PIXEL_RATIO_EPSILON
  )
    return a.pixelMismatchRatio - b.pixelMismatchRatio;

  if (a.actionableCount !== b.actionableCount) return a.actionableCount - b.actionableCount;

  // Final tie-breaker only: with measurably equal quality, prefer the later
  // proposal, which at worst carries the same implementation more recently
  // validated.
  return right.iteration - left.iteration;
}

/**
 * Selects the best validated, rendered candidate. Returns undefined when no
 * iteration produced one — an honest absence, never a default to "latest".
 */
export function selectBestCandidate(
  iterations: readonly ConvergenceIteration[],
): ConvergenceIteration | undefined {
  const candidates = iterations.filter((iteration) => iteration.quality.renderable);
  if (candidates.length === 0) return undefined;
  return [...candidates].sort(compare)[0];
}
