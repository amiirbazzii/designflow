// workflows/workflow-design-to-code/src/visual-convergence/finding-comparison.ts
//
// Did the repair actually help? Answered deterministically, per finding.
//
// Findings are correlated across iterations by canonical identity, never by
// prose. A finding's id is derived from its expectation
// (`finding:expectation:<blueprint-element>:<property>`), the expectation from
// the immutable Blueprint — so the same requirement produces the same key in
// every iteration, however differently a sentence about it might be worded.
import type {
  FindingComparisonEntry,
  IterationComparison,
  VisualDeltaReport,
  VisualFindingV1,
} from "@designflow/sdk";

import { comparablePixelRatio, isActionable } from "./convergence-policy";

/** Below this, a numeric movement is noise, not improvement or regression. */
const DELTA_EPSILON_PX = 0.5;
/** Below this, a pixel-ratio movement is noise. */
const PIXEL_RATIO_EPSILON = 0.005;

function viewportOf(finding: VisualFindingV1): string {
  const entry = finding.evidenceReferences.find((reference) => reference.startsWith("viewport:"));
  return entry === undefined ? "unknown" : entry.slice("viewport:".length);
}

/** Canonical comparison key: expectation-derived id + category + viewport. */
export function findingKey(finding: VisualFindingV1): string {
  return `${finding.findingId}|${finding.category}|${viewportOf(finding)}`;
}

function classify(previous: VisualFindingV1 | undefined, current: VisualFindingV1 | undefined): FindingComparisonEntry["state"] {
  if (previous !== undefined && current === undefined) return "resolved";
  if (previous === undefined && current !== undefined) return "new";
  if (previous === undefined || current === undefined) return "incomparable";

  const before = previous.measurableDelta;
  const after = current.measurableDelta;
  if (before === undefined || after === undefined)
    // Both present but nothing numeric to compare — the mismatch persists.
    return previous.actualValue === current.actualValue ? "unchanged" : "incomparable";

  const movement = Math.abs(before) - Math.abs(after);
  if (movement > DELTA_EPSILON_PX) return "improved";
  if (movement < -DELTA_EPSILON_PX) return "regressed";
  return "unchanged";
}

/**
 * Compares two consecutive reports of the same Blueprint.
 *
 * Only actionable-grade deterministic findings are compared — informational
 * and ambiguity placeholders do not move the verdict, exactly as they do not
 * trigger repair.
 */
export function compareReports(previous: VisualDeltaReport, current: VisualDeltaReport): IterationComparison {
  const previousByKey = new Map(previous.findings.filter(isActionable).map((finding) => [findingKey(finding), finding]));
  const currentByKey = new Map(current.findings.filter(isActionable).map((finding) => [findingKey(finding), finding]));

  const keys = new Set([...previousByKey.keys(), ...currentByKey.keys()]);
  const entries: FindingComparisonEntry[] = [];
  const counts = { resolved: 0, improved: 0, unchanged: 0, regressed: 0, introduced: 0, incomparable: 0 };

  for (const key of [...keys].sort()) {
    const before = previousByKey.get(key);
    const after = currentByKey.get(key);
    const state = classify(before, after);
    counts[state === "new" ? "introduced" : state] += 1;

    const carrier = after ?? before!;
    entries.push({
      key,
      state,
      ...(before?.measurableDelta !== undefined ? { previousDelta: before.measurableDelta } : {}),
      ...(after?.measurableDelta !== undefined ? { currentDelta: after.measurableDelta } : {}),
      severity: carrier.severity,
      category: carrier.category,
    });
  }

  const previousPixel = comparablePixelRatio(previous);
  const currentPixel = comparablePixelRatio(current);
  let pixelMovement: "improved" | "regressed" | "unchanged" | "incomparable" = "incomparable";
  if (previousPixel !== undefined && currentPixel !== undefined) {
    const movement = previousPixel - currentPixel;
    pixelMovement = movement > PIXEL_RATIO_EPSILON ? "improved" : movement < -PIXEL_RATIO_EPSILON ? "regressed" : "unchanged";
  }

  const gains = counts.resolved + counts.improved + (pixelMovement === "improved" ? 1 : 0);
  const harms = counts.regressed + counts.introduced + (pixelMovement === "regressed" ? 1 : 0);

  const verdict =
    harms > 0 && gains > 0
      ? "mixed"
      : harms > 0
        ? "regressed"
        : gains > 0
          ? "improved"
          : "no_measurable_improvement";

  return {
    ...counts,
    ...(previousPixel !== undefined ? { previousPixelMismatchRatio: previousPixel } : {}),
    ...(currentPixel !== undefined ? { currentPixelMismatchRatio: currentPixel } : {}),
    verdict,
    entries: entries.slice(0, 256),
  };
}
