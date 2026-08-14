// workflows/workflow-design-to-code/src/visual-convergence/convergence-policy.ts
//
// Which findings deserve a repair, and when a candidate is acceptable.
//
// The Builder never chooses this. Whether refinement is required is a
// deterministic reading of the trusted report: deterministic findings of
// repair-triggering severity trigger repair; informational findings,
// low-confidence or ambiguous evidence, unavailable measurements and
// below-tolerance differences do not. Critic annotations remain advisory —
// `criticSeverityMayEscalate: false` still holds, so a model's opinion cannot
// become the reason another iteration is spent.
import type { IterationQuality, RenderedState, VisualDeltaReport, VisualFindingV1 } from "@designflow/sdk";

/** The stage of the loop a report leads to, before budget is considered. */
export type AcceptanceStatus = "converged" | "converged_with_findings" | "repair_required";

/** Above this a measured delta is a visible defect, not rendering noise. */
const SIGNIFICANT_DELTA_PX = 8;
/** Or above this share of the expected value, for small elements. */
const SIGNIFICANT_DELTA_RATIO = 0.2;

/**
 * A `minor` measured mismatch can still be a repair-worthy defect: the
 * expectation compiler grades geometry `minor` because most deltas are
 * subpixel noise, but a button at 30px where the design says 56px is not
 * noise. Significance is arithmetic over the measurement, never judgment.
 */
function significantMeasuredMismatch(finding: VisualFindingV1): boolean {
  if (finding.measurableDelta === undefined) return false;
  const magnitude = Math.abs(finding.measurableDelta);
  const expected = Number.parseFloat(finding.expectedValue ?? "");
  return (
    magnitude > SIGNIFICANT_DELTA_PX ||
    (Number.isFinite(expected) && expected > 0 && magnitude > expected * SIGNIFICANT_DELTA_RATIO)
  );
}

/**
 * A finding the host would spend a repair on.
 *
 * Deterministic origin, an actual measurement (`not-applicable` marks the
 * ambiguous ones, `confidence: 0` the unidentifiable ones) and either a
 * severity the pass/fail policy already treats as outcome-moving or a
 * significant measured delta.
 */
export function isActionable(finding: VisualFindingV1): boolean {
  return (
    finding.origin === "deterministic" &&
    finding.status !== "not-applicable" &&
    finding.confidence > 0 &&
    (finding.severity === "critical" ||
      finding.severity === "major" ||
      (finding.severity === "minor" && significantMeasuredMismatch(finding)))
  );
}

export function actionableFindings(report: VisualDeltaReport): readonly VisualFindingV1[] {
  return report.findings.filter(isActionable);
}

export function missingRequiredFindings(report: VisualDeltaReport): readonly VisualFindingV1[] {
  return actionableFindings(report).filter((finding) => finding.category === "missing-element");
}

/** One comparable pixel ratio for a report, when any comparison happened. */
export function comparablePixelRatio(report: VisualDeltaReport): number | undefined {
  const compared = report.pixelComparisons.filter(
    (comparison) => comparison.status === "compared" && comparison.mismatchRatio !== undefined,
  );
  if (compared.length === 0) return undefined;
  return Math.max(...compared.map((comparison) => comparison.mismatchRatio!));
}

/** The measurable quality of one evaluated state, for selection and comparison. */
export function deriveIterationQuality(report: VisualDeltaReport, renderedState: RenderedState): IterationQuality {
  const actionable = actionableFindings(report);
  const pixel = comparablePixelRatio(report);
  return {
    renderable: renderedState.status === "rendered",
    missingRequiredCount: missingRequiredFindings(report).length,
    criticalCount: actionable.filter((finding) => finding.severity === "critical").length,
    majorCount: actionable.filter((finding) => finding.severity === "major").length,
    unresolvedExpectationCount: report.correspondence.ambiguous + report.correspondence.unmatched,
    actionableCount: actionable.length,
    ...(pixel !== undefined ? { pixelMismatchRatio: pixel } : {}),
  };
}

/**
 * Whether this state is acceptable as-is.
 *
 * Perfection is not the bar: a state with only minor and informational
 * differences converges *with findings* rather than spending budget chasing a
 * 0% pixel mismatch.
 */
export function acceptanceStatus(report: VisualDeltaReport): AcceptanceStatus {
  if (actionableFindings(report).length > 0) return "repair_required";
  const remaining = report.findings.filter(
    (finding) => finding.origin === "deterministic" && finding.status !== "not-applicable",
  );
  return remaining.length === 0 ? "converged" : "converged_with_findings";
}

/** A repair may only continue on usable evidence — not on a guess. */
export function evidenceUsable(renderedState: RenderedState, report: VisualDeltaReport): boolean {
  return renderedState.status === "rendered" && report.outcome !== "inconclusive";
}
