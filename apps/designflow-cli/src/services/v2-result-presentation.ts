// apps/designflow-cli/src/services/v2-result-presentation.ts
//
// V2-9: the product's reading of the V2 canonical artifacts.
//
// Deterministic projections of `visual-convergence`, `v2-final-review` and
// `v2-finalization-result` into normal product language. Normal mode gets
// the result; hashes, thresholds, candidate ranks and workflow ids stay in
// Details. Nothing here is a source of truth, and nothing here reads legacy
// correction artifacts.
import type { ReviewCheck } from "./proposal-review";

interface ConvergenceIterationFacts {
  readonly iteration: number;
  readonly quality: {
    readonly actionableCount: number;
    readonly missingRequiredCount: number;
  };
  readonly comparison?: {
    readonly resolved: number;
    readonly improved: number;
    readonly regressed: number;
    readonly introduced: number;
  };
}

export interface ConvergenceFacts {
  readonly status: string;
  readonly iterationsPerformed: number;
  readonly iterations: readonly ConvergenceIterationFacts[];
  readonly selectedIteration?: number;
}

export interface FinalReviewFacts {
  readonly convergence: { readonly status: string; readonly selectedIteration: number; readonly iterationsPerformed: number };
  readonly visual: { readonly remainingFindingCount: number };
  readonly files: readonly { readonly path: string }[];
}

export interface FinalizationFacts {
  readonly status: string;
  readonly rollbackPerformed?: boolean;
  readonly metrics?: { readonly finalizationFilesApplied?: number; readonly finalizationSelectedIteration?: number };
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

export function convergenceFacts(payload: unknown): ConvergenceFacts | undefined {
  const root = safeRecord(payload);
  if (root === undefined || typeof root.status !== "string" || !Array.isArray(root.iterations)) return undefined;
  return root as unknown as ConvergenceFacts;
}

export function finalReviewFacts(payload: unknown): FinalReviewFacts | undefined {
  const root = safeRecord(payload);
  if (root === undefined || safeRecord(root.visual) === undefined || safeRecord(root.convergence) === undefined) return undefined;
  return root as unknown as FinalReviewFacts;
}

export function finalizationFacts(payload: unknown): FinalizationFacts | undefined {
  const root = safeRecord(payload);
  if (root === undefined || typeof root.status !== "string") return undefined;
  return root as unknown as FinalizationFacts;
}

/** One line saying what the visual check concluded (§18). */
export function visualSummaryLine(convergence: ConvergenceFacts): string {
  if (convergence.status === "converged") return "Visual check passed";
  if (convergence.status === "converged_with_findings") {
    const selected = convergence.iterations.find((entry) => entry.iteration === convergence.selectedIteration);
    const remaining = selected?.quality.actionableCount ?? 0;
    return remaining > 0
      ? `Visual check found differences — acceptable with ${remaining} remaining`
      : "Visual check acceptable with minor differences";
  }
  if (convergence.status === "inconclusive") return "Visual verification inconclusive";
  return "Visual check did not reach an acceptable result";
}

/**
 * The bounded refinement story (§19). Empty when no repair ran, so a run
 * that accepted its first implementation never shows a Refining block.
 */
export function refinementStoryLines(convergence: ConvergenceFacts): readonly string[] {
  if (convergence.iterationsPerformed <= 1) return [];

  const lines: string[] = ["Refining"];
  for (const iteration of convergence.iterations) {
    if (iteration.comparison === undefined) {
      lines.push(`  Iteration ${iteration.iteration + 1} — ${iteration.quality.actionableCount} difference${iteration.quality.actionableCount === 1 ? "" : "s"}`);
      continue;
    }
    const parts: string[] = [];
    if (iteration.comparison.resolved > 0) parts.push(`${iteration.comparison.resolved} resolved`);
    if (iteration.comparison.improved > 0) parts.push(`${iteration.comparison.improved} improved`);
    if (iteration.comparison.regressed + iteration.comparison.introduced > 0)
      parts.push("introduced a regression");
    if (parts.length === 0) parts.push("no measurable change");
    lines.push(`  Iteration ${iteration.iteration + 1} — ${parts.join(", ")}`);
  }
  if (convergence.selectedIteration !== undefined) {
    lines.push("");
    lines.push("Selected implementation");
    lines.push(`  Iteration ${convergence.selectedIteration + 1} of ${convergence.iterationsPerformed}`);
    const last = convergence.iterations.at(-1);
    if (last !== undefined && convergence.selectedIteration !== last.iteration)
      lines.push("  A later attempt regressed, so the stronger earlier implementation was kept.");
  }
  return lines;
}

/** Review-screen checks derived from the exact V2 review artifact (§22). */
export function v2ReviewChecks(review: FinalReviewFacts): readonly ReviewCheck[] {
  const checks: ReviewCheck[] = [
    { label: "Build passed" },
    { label: "Page rendered" },
    { label: "Project unchanged" },
  ];
  if (review.convergence.status === "converged") checks.push({ label: "Visual refinement complete" });
  else if (review.convergence.status === "converged_with_findings")
    checks.push({
      label: `Visual result acceptable with ${review.visual.remainingFindingCount} remaining difference${review.visual.remainingFindingCount === 1 ? "" : "s"}`,
    });
  if (review.convergence.iterationsPerformed > 1)
    checks.push({
      label: `Selected iteration ${review.convergence.selectedIteration + 1} of ${review.convergence.iterationsPerformed}`,
    });
  return checks;
}

/** The final product outcome lines for a finished V2 run (§24–§28). */
export function finalOutcomeLines(
  result: FinalizationFacts,
  convergence?: ConvergenceFacts,
): readonly string[] {
  switch (result.status) {
    case "applied_validated": {
      const files = result.metrics?.finalizationFilesApplied;
      return [
        "Implementation complete",
        "",
        "✓ Applied approved changes",
        "✓ Validation passed",
        ...(convergence !== undefined ? ["", "Visual result", `  ${visualSummaryLine(convergence)}`] : []),
        ...(files !== undefined ? ["", "Files changed", `  ${files}`] : []),
      ];
    }
    case "validation_failed_rolled_back":
      return [
        "Changes were rolled back",
        "",
        "The implementation was applied, but project validation failed.",
        "Your project was restored to the previous state.",
      ];
    case "approval_declined":
      return [
        "Changes not applied",
        "",
        "You declined the implementation.",
        "No project files were changed.",
      ];
    case "approval_expired":
      return [
        "Approval expired",
        "",
        "No project files were changed.",
        "Approve again to apply the same exact implementation.",
      ];
    case "project_changed":
      return [
        "Project changed while DesignFlow was working",
        "",
        "No DesignFlow changes were applied.",
        "Run again to generate an implementation against the current project.",
      ];
    case "cancelled":
      return ["Cancelled", "", "No project files were changed."];
    default:
      return ["The implementation was not applied", "", "No project files were changed."];
  }
}
