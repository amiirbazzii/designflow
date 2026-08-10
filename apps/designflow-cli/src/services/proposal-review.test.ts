// apps/designflow-cli/src/services/proposal-review.test.ts
import { describe, expect, test } from "bun:test";

import {
  buildProposalReview,
  renderReadyToApply,
  renderReviewFileList,
} from "./proposal-review";

describe("Phase 8 proposal review state", () => {
  test("create diff is exact and counted", () => {
    const review = buildProposalReview([
      { path: "src/pages/NewPage.jsx", action: "create", proposedContent: "line one\nline two\n" },
    ]);
    expect(review.totals).toEqual({ fileCount: 1, additions: 2, deletions: 0 });
    expect(review.files[0]!.diff).toEqual([
      "--- /dev/null",
      "+++ src/pages/NewPage.jsx (create)",
      "+ line one",
      "+ line two",
    ]);
  });

  test("modify diff is an exact line diff of current versus proposed", () => {
    const review = buildProposalReview([
      {
        path: "src/App.jsx",
        action: "modify",
        currentContent: "keep\nold line\nend\n",
        proposedContent: "keep\nnew line\nend\n",
      },
    ]);
    const file = review.files[0]!;
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
    expect(file.diff).toContain("- old line");
    expect(file.diff).toContain("+ new line");
    expect(file.diff).toContain("  keep");
  });

  test("delete diff shows removed content", () => {
    const review = buildProposalReview([
      { path: "src/Old.jsx", action: "delete", currentContent: "gone\n" },
    ]);
    expect(review.files[0]!.diff).toEqual([
      "--- src/Old.jsx",
      "+++ /dev/null (delete)",
      "- gone",
    ]);
    expect(review.totals).toEqual({ fileCount: 1, additions: 0, deletions: 1 });
  });

  test("summary totals equal the sum of per-file counts", () => {
    const review = buildProposalReview([
      { path: "a.jsx", action: "create", proposedContent: "one\ntwo\nthree\n" },
      { path: "b.jsx", action: "modify", currentContent: "x\n", proposedContent: "y\n" },
      { path: "c.jsx", action: "delete", currentContent: "z\n" },
    ]);
    const additions = review.files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = review.files.reduce((sum, file) => sum + file.deletions, 0);
    expect(review.totals.additions).toBe(additions);
    expect(review.totals.deletions).toBe(deletions);
    expect(review.totals.fileCount).toBe(3);
  });

  test("CRLF-only differences do not render as whole-file changes", () => {
    const review = buildProposalReview([
      {
        path: "src/App.jsx",
        action: "modify",
        currentContent: "same\r\nlines\r\n",
        proposedContent: "same\nlines\n",
      },
    ]);
    expect(review.files[0]!.additions).toBe(0);
    expect(review.files[0]!.deletions).toBe(0);
  });

  test("ready-to-apply renders counts, groups, and checks without internal identifiers", () => {
    const review = buildProposalReview([
      { path: "src/pages/NewPage.jsx", action: "create", proposedContent: "a\n" },
      { path: "src/App.jsx", action: "modify", currentContent: "x\n", proposedContent: "y\n" },
    ]);
    const output = renderReadyToApply(review, [
      { label: "Safe paths" },
      { label: "Design covered" },
      { label: "Proposal validated" },
      { label: "Build checked" },
    ]).join("\n");
    expect(output).toContain("Ready to apply");
    expect(output).toContain("2 files changed");
    expect(output).toContain("+2  -1");
    expect(output).toContain("Create\n  src/pages/NewPage.jsx");
    expect(output).toContain("Modify\n  src/App.jsx");
    expect(output).toContain("✓ Safe paths");
    expect(output).toContain("✓ Build checked");
    expect(output).toContain("No files have been changed yet.");
    for (const forbidden of ["hash", "fingerprint", "artifact", "payloadId", "workflowId", "profile"]) {
      expect(output.toLowerCase()).not.toContain(forbidden);
    }
  });

  test("the file list shows per-file operations and counts", () => {
    const review = buildProposalReview([
      { path: "src/pages/NewPage.jsx", action: "create", proposedContent: "a\nb\n" },
    ]);
    const output = renderReviewFileList(review).join("\n");
    expect(output).toContain("src/pages/NewPage.jsx");
    expect(output).toContain("Create");
    expect(output).toContain("+2 -0");
  });

  test("only supplied checks are rendered — none are invented", () => {
    const review = buildProposalReview([
      { path: "a.jsx", action: "create", proposedContent: "a\n" },
    ]);
    const output = renderReadyToApply(review, [{ label: "Safe paths" }]).join("\n");
    expect(output).toContain("✓ Safe paths");
    expect(output).not.toContain("Design covered");
    expect(output).not.toContain("Build checked");
    expect(output).not.toContain("Snapshot");
  });
});
