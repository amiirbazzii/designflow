// workflows/workflow-qa-review/src/evaluate.test.ts
import { describe, expect, test } from "bun:test";
import type { EvaluableArtifact } from "@designflow/sdk";
import { evaluateQaReviewerCriterion } from "./evaluate";
import { ARTIFACT_IDS } from "./types";

/**
 * Proves the QA Reviewer's first deterministic evaluation layer against
 * fixtures built from this workflow's own Zod schema — never redefined here.
 */

function artifact(id: string, overrides?: Partial<EvaluableArtifact>): EvaluableArtifact {
  return { artifactId: id, status: "created", ...overrides };
}

function payloadReader(payloads: Record<string, unknown>) {
  return (artifactId: string): unknown => payloads[artifactId];
}

describe("evaluateQaReviewerCriterion", () => {
  test("a well-formed report satisfies its required criteria", () => {
    const artifacts = [
      artifact(ARTIFACT_IDS.issueList),
      artifact(ARTIFACT_IDS.severityAssessment),
      artifact(ARTIFACT_IDS.accessibilityReview),
      artifact(ARTIFACT_IDS.qaReport),
    ];

    const issues = [
      { id: "issue-1", description: "Missing alt text", kind: "correctness", severity: "major" },
      { id: "issue-2", description: "Inconsistent spacing", kind: "consistency", severity: "minor" },
    ];

    const counts = { blocker: 0, major: 1, minor: 1, info: 0 };

    const payloads = payloadReader({
      [ARTIFACT_IDS.severityAssessment]: {
        targetId: "checkout-flow",
        threshold: "minor",
        issues,
        counts,
        flaggedIssueIds: ["issue-1", "issue-2"],
      },
      [ARTIFACT_IDS.accessibilityReview]: {
        targetId: "checkout-flow",
        findings: [{ id: "a11y-1", description: "Missing aria-label", category: "aria" }],
        counts: { aria: 1, contrast: 0, keyboard: 0, semantics: 0 },
      },
      [ARTIFACT_IDS.qaReport]: {
        targetId: "checkout-flow",
        verdict: "fail",
        threshold: "minor",
        issueCount: 2,
        flaggedIssueCount: 2,
        accessibilityFindingCount: 1,
        issues,
        accessibilityFindings: [{ id: "a11y-1", description: "Missing aria-label", category: "aria" }],
        severityCounts: counts,
        accessibilityCounts: { aria: 1, contrast: 0, keyboard: 0, semantics: 0 },
      },
    });

    expect(evaluateQaReviewerCriterion("findings-have-severity", artifacts, payloads).satisfied).toBe(true);
    expect(evaluateQaReviewerCriterion("accessibility-category-covered", artifacts, payloads).satisfied).toBe(true);
    expect(evaluateQaReviewerCriterion("report-internally-consistent", artifacts, payloads).satisfied).toBe(true);
  });

  test("an issue missing severity fails deterministically instead of throwing", () => {
    const artifacts = [
      artifact(ARTIFACT_IDS.severityAssessment),
      artifact(ARTIFACT_IDS.accessibilityReview),
      artifact(ARTIFACT_IDS.qaReport),
    ];

    const payloads = payloadReader({
      // Malformed: one issue is missing its severity field entirely.
      [ARTIFACT_IDS.severityAssessment]: {
        targetId: "checkout-flow",
        threshold: "minor",
        issues: [
          { id: "issue-1", description: "Missing alt text", kind: "correctness", severity: "major" },
          { id: "issue-2", description: "Inconsistent spacing", kind: "consistency" },
        ],
        counts: { blocker: 0, major: 1, minor: 0, info: 0 },
        flaggedIssueIds: ["issue-1"],
      },
      [ARTIFACT_IDS.accessibilityReview]: {
        targetId: "checkout-flow",
        findings: [],
        counts: { aria: 0, contrast: 0, keyboard: 0, semantics: 0 },
      },
    });

    let result;
    expect(() => {
      result = evaluateQaReviewerCriterion("findings-have-severity", artifacts, payloads);
    }).not.toThrow();

    expect(result?.satisfied).toBe(false);
    expect(result?.note).toBeDefined();
  });
});
