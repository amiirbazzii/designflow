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

export type PersistedVisualClassification = NonNullable<VisualResultFacts["overallStatus"]>;

export interface VisualResultViewInput {
  readonly reportAvailable: boolean;
  readonly classification?: PersistedVisualClassification;
  readonly findingSummaries: readonly string[];
  readonly unreachableChangedFiles?: number;
  readonly correctionEligibility: {
    readonly status: string;
    readonly reason?: string;
    readonly iterationNumber?: number;
    readonly maximumIterations?: number;
  };
}

export interface VisualResultView {
  readonly classification?: PersistedVisualClassification;
  readonly title: string;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly reachability?: "rendered" | "unreachable";
  readonly canImprove: boolean;
  readonly improveUnavailableReason?: string;
  readonly reportAvailable: boolean;
  readonly actions: readonly ("View report" | "Improve" | "Finish")[];
}

/**
 * Pure product adapter for persisted Stage 5 facts and the host's existing
 * correction eligibility decision. It does not calculate visual outcomes or
 * eligibility; it only translates those authoritative facts for the TUI.
 */
export function buildVisualResultView(input: VisualResultViewInput): VisualResultView {
  const canImprove = input.correctionEligibility.status === "eligible";
  const title = titleFor(input.classification);
  const summary = summaryFor(input.classification, input.reportAvailable);
  const findings = input.findingSummaries.slice(0, 5).map((finding) => finding.slice(0, 200));
  const reachability = input.unreachableChangedFiles === undefined
    ? undefined
    : input.unreachableChangedFiles > 0 ? "unreachable" : "rendered";
  const actions: Array<"View report" | "Improve" | "Finish"> = [];
  if (input.reportAvailable) actions.push("View report");
  if (canImprove) actions.push("Improve");
  actions.push("Finish");

  return {
    ...(input.classification === undefined ? {} : { classification: input.classification }),
    title,
    summary,
    findings,
    ...(reachability === undefined ? {} : { reachability }),
    canImprove,
    ...(canImprove || input.correctionEligibility.reason === undefined ? {} : { improveUnavailableReason: input.correctionEligibility.reason }),
    reportAvailable: input.reportAvailable,
    actions,
  };
}

function titleFor(classification: PersistedVisualClassification | undefined): string {
  if (classification === undefined) return "Missing evidence";
  switch (classification) {
    case "pass": return "Looks good";
    case "pass_with_findings": return "Needs improvement";
    case "fail": return "Needs improvement";
    case "inconclusive": return "Inconclusive";
    case "unavailable": return "Missing evidence";
  }
}

function summaryFor(classification: PersistedVisualClassification | undefined, reportAvailable: boolean): string {
  if (!reportAvailable || classification === undefined) return "Visual validation evidence is unavailable.";
  switch (classification) {
    case "pass": return "The rendered implementation matches the selected design within the recorded validation result.";
    case "pass_with_findings": return "The rendered implementation passed validation with recorded visual findings.";
    case "fail": return "The rendered implementation differs from the selected design according to the recorded visual result.";
    case "inconclusive": return "DesignFlow could not reach a trustworthy visual conclusion.";
    case "unavailable": return "A visual result was recorded, but the evidence needed for comparison is missing.";
  }
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
