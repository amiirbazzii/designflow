// packages/sdk/src/finalization/test/finalization-contracts.test.ts
import { describe, expect, test } from "bun:test";

import { finalImplementationReviewSchema, v2FinalizationResultSchema } from "../finalization-contracts";

const review = () => ({
  schemaVersion: "1",
  proposalArtifactId: "proposed-file-changes",
  proposalHash: "a".repeat(64),
  projectId: "p",
  baseProjectFingerprint: "f".repeat(64),
  convergence: { status: "converged_with_findings", selectedIteration: 1, iterationsPerformed: 3 },
  visual: { outcome: "pass_with_findings", remainingFindingCount: 1, remainingFindings: ["1 remaining minor finding"] },
  files: [{ path: "src/App.jsx", action: "modify", bytes: 240 }],
  packageChanges: [],
  validationSummary: ["Proposal validated", "Project unchanged"],
});

describe("finalization contracts", () => {
  test("the review is a strict view — no room for a second proposal body", () => {
    expect(finalImplementationReviewSchema.safeParse(review()).success).toBe(true);
    expect(
      finalImplementationReviewSchema.safeParse({ ...review(), fileContents: ["export default"] }).success,
    ).toBe(false);
  });

  test("every terminal status is typed; a bare failed is refused", () => {
    const base = {
      schemaVersion: "1",
      binding: {
        projectId: "p",
        baseProjectFingerprint: "f".repeat(64),
        proposalArtifactId: "proposed-file-changes",
        proposalHash: "a".repeat(64),
        convergenceArtifactId: "visual-convergence",
      },
      rollbackPerformed: false,
      metrics: {
        finalizationBindingChecks: 3,
        finalizationApprovalOutcome: "approved",
        finalizationProjectDriftDetected: false,
        finalizationSnapshotCreated: true,
        finalizationFilesApplied: 2,
        finalizationValidationStatus: "passed",
        finalizationRollbackPerformed: false,
      },
      notes: [],
    };
    for (const status of [
      "applied_validated",
      "approval_declined",
      "approval_expired",
      "project_changed",
      "binding_mismatch",
      "apply_failed",
      "validation_failed_rolled_back",
      "cancelled",
    ])
      expect(v2FinalizationResultSchema.safeParse({ ...base, status }).success).toBe(true);
    expect(v2FinalizationResultSchema.safeParse({ ...base, status: "failed" }).success).toBe(false);
  });
});
