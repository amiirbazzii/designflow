// packages/agents/src/visual-validation/visual-delta-report.ts
//
// The pre-approval verdict (Agent Architecture V2, phase V2-5).
//
// One function decides what the run means, from deterministic evidence and a
// declared policy. The Critic's annotations travel in the report and inform
// the person reading it; they do not decide it. That asymmetry is the point:
// a model being unavailable, wrong or unusually agreeable must never change
// whether DesignFlow says an implementation matches its design.
import {
  DEFAULT_VISUAL_PASS_FAIL_POLICY,
  VISUAL_DELTA_REPORT_SCHEMA_VERSION,
  VISUAL_VALIDATION_SCHEMA_VERSION,
  visualDeltaReportSchema,
  type ElementCorrespondence,
  type PixelComparison,
  type RenderedState,
  type VisualCriticAnnotation,
  type VisualDeltaReport,
  type VisualFindingV1,
  type VisualOutcome,
} from "@designflow/sdk";

export interface AssembleVisualDeltaReportInput {
  readonly renderedState: RenderedState;
  readonly findings: readonly VisualFindingV1[];
  readonly annotations?: readonly VisualCriticAnnotation[];
  readonly expectationCount: number;
  readonly correspondences?: readonly ElementCorrespondence[];
  readonly critic?: VisualDeltaReport["critic"];
  readonly policy?: VisualDeltaReport["passFailPolicy"];
}

/** Above this, the rendered page and the design are visibly different. */
export const PIXEL_MISMATCH_MAJOR_RATIO = 0.15;
/** Below this, the difference is anti-aliasing and font hinting. */
export const PIXEL_MISMATCH_MINOR_RATIO = 0.02;

/**
 * Turns a completed pixel comparison into a deterministic finding.
 *
 * A comparison that did not happen produces nothing — `unavailable` is not a
 * clean bill of health and must not read as one, so it stays visible in
 * `pixelComparisons` and never becomes a silent pass.
 */
export function pixelComparisonFindings(
  comparisons: readonly PixelComparison[],
): readonly VisualFindingV1[] {
  const findings: VisualFindingV1[] = [];

  for (const comparison of comparisons) {
    if (comparison.status !== "compared") continue;
    const ratio = comparison.overlapMismatchRatio ?? comparison.mismatchRatio;
    if (ratio === undefined || ratio <= PIXEL_MISMATCH_MINOR_RATIO) continue;

    const percentage = Math.round(ratio * 1000) / 10;
    findings.push({
      schemaVersion: VISUAL_VALIDATION_SCHEMA_VERSION,
      findingId: `finding:pixel:${comparison.viewportId}`,
      category: "layout",
      severity: ratio > PIXEL_MISMATCH_MAJOR_RATIO ? "major" : "minor",
      confidence: 1,
      status: "confirmed",
      expectedValue: "the design's own screenshot",
      actualValue: `${percentage}% of compared pixels differ`,
      measurableDelta: Math.round(ratio * 10_000) / 10_000,
      explanation:
        `At ${comparison.viewportId}, ${percentage}% of the pixels the rendered implementation and the design share differ` +
        (comparison.alignmentStatus === "overlap-compared"
          ? ", measured over the region both images cover."
          : "."),
      evidenceReferences: [
        `viewport:${comparison.viewportId}`,
        ...(comparison.referenceEvidenceId !== undefined ? [comparison.referenceEvidenceId] : []),
      ],
      origin: "deterministic",
    });
  }

  return findings;
}

/**
 * Decides the outcome.
 *
 * `inconclusive` is a real answer here and is used wherever the evidence did
 * not arrive: no browser, no preview command, a project that moved. Reporting
 * "pass" because nothing was measured is the failure mode this whole phase
 * exists to remove.
 */
export function decideVisualOutcome(
  renderedState: RenderedState,
  findings: readonly VisualFindingV1[],
  policy: VisualDeltaReport["passFailPolicy"],
): { outcome: VisualOutcome; reason?: string } {
  if (renderedState.status === "project_changed_before_render")
    return {
      outcome: "inconclusive",
      reason: "The project changed after this proposal was planned, so it was never rendered.",
    };

  if (renderedState.status === "browser_unavailable")
    return policy.browserUnavailableIsInconclusive
      ? { outcome: "inconclusive", reason: "No browser was available to render the proposal." }
      : { outcome: "fail", reason: "No browser was available to render the proposal." };

  if (renderedState.status === "cancelled")
    return { outcome: "inconclusive", reason: "Rendering was cancelled before it produced evidence." };

  if (renderedState.status === "render_failed")
    return policy.renderFailureIsFailure
      ? {
          outcome: "fail",
          reason:
            renderedState.runtime.buildStatus === "failed"
              ? "The proposed implementation did not build."
              : "The proposed implementation built but could not be rendered.",
        }
      : { outcome: "inconclusive", reason: "The proposal could not be rendered." };

  const deterministic = findings.filter((finding) => finding.origin === "deterministic");
  const critical = deterministic.filter((finding) => finding.severity === "critical");
  const major = deterministic.filter((finding) => finding.severity === "major");
  const missing = deterministic.filter((finding) => finding.category === "missing-element");

  if (policy.criticalDeterministicFails && critical.length > 0)
    return {
      outcome: "fail",
      reason: `${critical.length} critical difference${critical.length === 1 ? "" : "s"} between the design and the rendered implementation.`,
    };

  if (policy.missingRequiredElementFails && missing.some((finding) => finding.severity === "critical"))
    return { outcome: "fail", reason: "Required content from the design is missing from the rendered implementation." };

  if (policy.majorDeterministicNeedsRefinement && major.length > 0)
    return {
      outcome: "needs_refinement",
      reason: `${major.length} major difference${major.length === 1 ? "" : "s"} worth another pass before approval.`,
    };

  if (deterministic.length > 0)
    return { outcome: "pass_with_findings", reason: `${deterministic.length} minor difference${deterministic.length === 1 ? "" : "s"}.` };

  return { outcome: "pass" };
}

export function assembleVisualDeltaReport(input: AssembleVisualDeltaReportInput): VisualDeltaReport {
  const policy = input.policy ?? { ...DEFAULT_VISUAL_PASS_FAIL_POLICY };
  const { outcome, reason } = decideVisualOutcome(input.renderedState, input.findings, policy);

  const correspondences = input.correspondences ?? input.renderedState.correspondences;

  return visualDeltaReportSchema.parse({
    schemaVersion: VISUAL_DELTA_REPORT_SCHEMA_VERSION,
    outcome,
    binding: input.renderedState.binding,
    findings: input.findings.slice(0, 256),
    annotations: (input.annotations ?? []).slice(0, 256),
    expectationCount: input.expectationCount,
    correspondence: {
      matched: correspondences.filter((entry) => entry.state === "matched").length,
      ambiguous: correspondences.filter((entry) => entry.state === "ambiguous").length,
      unmatched: correspondences.filter((entry) => entry.state === "unmatched").length,
      signalsUsed: [...new Set(correspondences.flatMap((entry) => entry.signals))],
    },
    pixelComparisons: input.renderedState.pixelComparisons,
    critic: input.critic ?? { status: "not_requested", partitionCount: 0, patchCount: 0, summaries: [] },
    passFailPolicy: policy,
    ...(reason !== undefined ? { reason } : {}),
  });
}

/**
 * The reviewer-facing rendering of a report.
 *
 * Ordered by severity, because the first line a person reads should be the
 * worst thing that is true, and annotated with the Critic's impact statement
 * where it has one — clearly attributed, so nobody mistakes an interpretation
 * for the measurement beside it.
 */
export function formatVisualDeltaReport(report: VisualDeltaReport): string {
  const order = { critical: 0, major: 1, minor: 2, info: 3 } as const;
  const annotations = new Map(report.annotations.map((annotation) => [annotation.findingId, annotation]));

  const lines: string[] = [
    `Visual evaluation: ${report.outcome.replace(/_/g, " ")}${report.reason !== undefined ? ` — ${report.reason}` : ""}`,
    `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"} from ${report.expectationCount} design expectation${report.expectationCount === 1 ? "" : "s"}.`,
  ];

  const { matched, ambiguous, unmatched } = report.correspondence;
  if (ambiguous > 0 || unmatched > 0)
    lines.push(
      `Identified ${matched} design element${matched === 1 ? "" : "s"} in the render; ${ambiguous} could not be told apart and ${unmatched} were not found. No measurement was taken for those.`,
    );

  for (const comparison of report.pixelComparisons)
    if (comparison.status !== "compared")
      lines.push(
        `Pixel comparison at ${comparison.viewportId}: ${comparison.status.replace(/_/g, " ")}${comparison.reason !== undefined ? ` — ${comparison.reason}` : ""}.`,
      );

  for (const finding of [...report.findings].sort((left, right) => order[left.severity] - order[right.severity])) {
    lines.push(`- [${finding.severity}] ${finding.explanation}`);
    const annotation = annotations.get(finding.findingId);
    if (annotation?.userVisibleImpact !== undefined) lines.push(`    impact (interpreted): ${annotation.userVisibleImpact}`);
    if (annotation?.repairGuidance !== undefined) lines.push(`    suggested fix (interpreted): ${annotation.repairGuidance}`);
  }

  if (report.critic.status === "unavailable")
    lines.push("The Visual Critic was unavailable; every finding above is a direct measurement.");

  return lines.join("\n");
}
