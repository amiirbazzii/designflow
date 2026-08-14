// workflows/workflow-design-to-code/src/finalization/finalization-report.ts
//
// A deterministic human-readable projection of one finalization result.
// A rendering, never a source of truth.
import type { FinalImplementationReview, V2FinalizationResult } from "@designflow/sdk";

export function renderFinalizationReport(
  result: V2FinalizationResult,
  review?: FinalImplementationReview,
): string {
  const lines: string[] = [];

  if (result.status === "applied_validated") {
    lines.push("Implementation applied", "");
    if (result.metrics.finalizationSelectedIteration !== undefined && review !== undefined)
      lines.push(
        "Selected iteration",
        `${result.metrics.finalizationSelectedIteration + 1} of ${review.convergence.iterationsPerformed}`,
        "",
      );
    lines.push("Files", `${result.metrics.finalizationFilesApplied} changed`, "");
    if (review !== undefined)
      lines.push(
        "Visual result",
        review.visual.remainingFindingCount === 0
          ? "Complete"
          : `Acceptable with ${review.visual.remainingFindingCount} remaining finding(s)`,
        "",
      );
    lines.push(
      "Safety",
      "✓ Proposal binding verified",
      "✓ Project unchanged",
      "✓ Snapshot created",
      "✓ Applied exact approved proposal",
      "✓ Required validation passed",
    );
    return lines.join("\n");
  }

  if (result.status === "project_changed") {
    return [
      "Project changed before apply",
      "",
      "No files were changed by DesignFlow.",
      "",
      "The approved implementation was created against an earlier project state.",
      "Run DesignFlow again to regenerate against the current project.",
    ].join("\n");
  }

  if (result.status === "validation_failed_rolled_back") {
    return [
      "Applied, then rolled back",
      "",
      "A required project check failed after apply.",
      "The project was restored from the pre-write snapshot.",
    ].join("\n");
  }

  const HEADLINE: Record<string, string> = {
    approval_declined: "Approval declined — no files were changed.",
    approval_expired: "Approval expired — no files were changed. Approve again to apply the same exact proposal.",
    binding_mismatch: "Binding mismatch — the proposal on record is not the approved proposal. No files were changed.",
    apply_failed: "Apply failed — the project was not left in a partial state.",
    cancelled: "Cancelled — no files were changed.",
  };
  return HEADLINE[result.status] ?? result.status;
}
