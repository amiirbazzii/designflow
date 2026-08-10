// apps/designflow-cli/src/services/visual-result.ts

/**
 * Phase 10 visual-result presentation model.
 *
 * A pure translation of persisted Stage-5 evidence — the stage-5 summary's
 * canonical `overallStatus`, the validated findings, the preview/capture
 * records, deterministic reachability counts, and the correction
 * eligibility the host already computed — into the product's post-apply
 * "Visual result" screen. Nothing here interprets pixels, decides
 * eligibility, or mutates anything: what was not persisted is not shown,
 * and "Improve" is offered only when the deterministic host already said
 * correction is actionable.
 */

export type VisualResultState =
  | "looks_good"
  | "needs_improvement"
  | "non_actionable"
  | "inconclusive"
  | "failed";

export interface VisualResultFacts {
  /** Canonical stage-5 overall status, when the summary was persisted. */
  readonly overallStatus?:
    | "pass"
    | "pass_with_findings"
    | "fail"
    | "inconclusive"
    | "unavailable"
    | undefined;
  /** Bounded human explanations of the recorded findings, worst first. */
  readonly findingSummaries: readonly string[];
  /** Host-computed correction eligibility: only "eligible" offers Improve. */
  readonly correctionEligible: boolean;
  readonly actionableFindingCount: number;
  /** Truthful pipeline facts, each from its own persisted record. */
  readonly previewReady: boolean;
  readonly captured: boolean;
  readonly compared: boolean;
  /** Deterministic render-reachability counts from module validation. */
  readonly unreachableChangedFiles?: number | undefined;
  /** Reference identity, e.g. the selected frame name. */
  readonly referenceLabel?: string | undefined;
  /** Bounded safe metrics for Details (e.g. per-viewport mismatch ratios). */
  readonly detailMetrics: readonly string[];
}

export interface VisualResult {
  readonly state: VisualResultState;
  readonly headline: string;
  readonly lines: readonly string[];
  readonly detailLines: readonly string[];
  readonly offerImprove: boolean;
}

function stateOf(facts: VisualResultFacts): VisualResultState {
  if (!facts.compared || facts.overallStatus === undefined) return "failed";
  switch (facts.overallStatus) {
    case "pass":
      return "looks_good";
    case "pass_with_findings":
    case "fail":
      return facts.correctionEligible ? "needs_improvement" : "non_actionable";
    case "inconclusive":
      return "inconclusive";
    case "unavailable":
      return "failed";
  }
}

const HEADLINES: Readonly<Record<VisualResultState, string>> = {
  looks_good: "Looks good",
  needs_improvement: "Needs improvement",
  non_actionable: "Needs review",
  inconclusive: "Visual comparison was inconclusive",
  failed: "Visual comparison could not complete",
};

export function buildVisualResult(facts: VisualResultFacts): VisualResult {
  const state = stateOf(facts);
  const lines: string[] = [];

  if (facts.referenceLabel !== undefined) {
    lines.push("", "Reference", `  Figma: ${facts.referenceLabel}`);
  }
  if (facts.captured) {
    lines.push("", "Implementation", "  Local preview captured");
  }

  if (facts.unreachableChangedFiles !== undefined && facts.unreachableChangedFiles > 0) {
    lines.push(
      "",
      "The new page was created, but it is not connected to the rendered application.",
    );
  }

  if (facts.findingSummaries.length > 0 && state !== "looks_good") {
    lines.push("", "Findings");
    for (const summary of facts.findingSummaries.slice(0, 5)) {
      lines.push(`  • ${summary.slice(0, 200)}`);
    }
  }

  switch (state) {
    case "non_actionable":
      lines.push(
        "",
        "Findings were recorded, but none can be corrected automatically with confidence.",
      );
      break;
    case "inconclusive":
      lines.push("", "Not enough trustworthy evidence to judge the visual match.");
      break;
    case "failed":
      lines.push("", "The applied changes remain in place; only the visual check is affected.");
      break;
    default:
      break;
  }

  return {
    state,
    headline: HEADLINES[state],
    lines,
    detailLines: facts.detailMetrics.slice(0, 20),
    offerImprove: state === "needs_improvement" && facts.actionableFindingCount > 0,
  };
}

export function renderVisualResult(result: VisualResult): string[] {
  return ["", "Visual result", result.headline, ...result.lines];
}
