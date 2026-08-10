// apps/designflow-cli/src/services/proposal-review.ts
import {
  diffLines,
  splitLines,
  type ProposalPreviewEntry,
} from "./proposal-preview";

/**
 * Phase 8 product review state for the exact validated proposal.
 *
 * Everything here is a pure function of the exact proposal entries the
 * approval hash binds — no regeneration, no summarization, no second "UI
 * proposal". The summary totals are computed from the same per-file diffs
 * the viewer displays, so the numbers a person reads are the numbers the
 * diff shows.
 *
 * Presentation only: this module never approves, rejects, writes, or
 * duplicates any deterministic safety logic. It renders facts and the
 * existing approval path decides.
 */

export interface ProposalReviewFile {
  readonly path: string;
  readonly action: "create" | "modify" | "delete";
  readonly additions: number;
  readonly deletions: number;
  /** Exact unified-style diff lines for this file. */
  readonly diff: readonly string[];
}

export interface ProposalReview {
  readonly files: readonly ProposalReviewFile[];
  readonly totals: {
    readonly fileCount: number;
    readonly additions: number;
    readonly deletions: number;
  };
}

/** A validation fact that actually ran and passed before the review screen. */
export interface ReviewCheck {
  readonly label: string;
}

function fileDiff(entry: ProposalPreviewEntry): readonly string[] {
  if (entry.action === "delete") {
    const current = splitLines(entry.currentContent ?? "");
    return [
      `--- ${entry.path}`,
      `+++ /dev/null (delete)`,
      ...current.map((line) => `- ${line}`),
    ];
  }
  const proposed = splitLines(entry.proposedContent ?? "");
  if (entry.action === "create" || entry.currentContent === undefined) {
    return [
      `--- /dev/null`,
      `+++ ${entry.path} (${entry.action})`,
      ...proposed.map((line) => `+ ${line}`),
    ];
  }
  return [
    `--- ${entry.path}`,
    `+++ ${entry.path} (modify)`,
    ...diffLines(splitLines(entry.currentContent), proposed),
  ];
}

/** Builds the review state from the exact proposal entries. */
export function buildProposalReview(
  entries: readonly ProposalPreviewEntry[],
): ProposalReview {
  const files = entries.map((entry) => {
    const diff = fileDiff(entry);
    return {
      path: entry.path,
      action: entry.action,
      additions: diff.filter((line) => line.startsWith("+ ")).length,
      deletions: diff.filter((line) => line.startsWith("- ")).length,
      diff,
    };
  });
  return {
    files,
    totals: {
      fileCount: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
  };
}

const ACTION_LABEL: Readonly<Record<ProposalReviewFile["action"], string>> = {
  create: "Create",
  modify: "Modify",
  delete: "Delete",
};

/**
 * The "Ready to apply" screen. Checks are supplied by the caller and must
 * only contain validations that genuinely ran and passed — this renderer
 * never invents one.
 */
export function renderReadyToApply(
  review: ProposalReview,
  checks: readonly ReviewCheck[],
): string[] {
  const lines = [
    "",
    "Ready to apply",
    "",
    `${review.totals.fileCount} file${review.totals.fileCount === 1 ? "" : "s"} changed`,
    `+${review.totals.additions}  -${review.totals.deletions}`,
  ];
  for (const action of ["create", "modify", "delete"] as const) {
    const group = review.files.filter((file) => file.action === action);
    if (group.length === 0) continue;
    lines.push("", ACTION_LABEL[action]);
    for (const file of group) lines.push(`  ${file.path}`);
  }
  if (checks.length > 0) {
    lines.push("");
    for (const check of checks) lines.push(`✓ ${check.label}`);
  }
  lines.push("", "No files have been changed yet.");
  return lines;
}

/** The file list shown when the person chooses "View diff". */
export function renderReviewFileList(review: ProposalReview): string[] {
  const lines = ["", "Files", ""];
  const width = Math.max(...review.files.map((file) => file.path.length), 0);
  for (const file of review.files) {
    lines.push(
      `  ${file.path.padEnd(width)}  ${ACTION_LABEL[file.action].padEnd(6)}  +${file.additions} -${file.deletions}`,
    );
  }
  return lines;
}
