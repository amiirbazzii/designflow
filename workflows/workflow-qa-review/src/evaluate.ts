// workflows/workflow-qa-review/src/evaluate.ts
import {
  cannotDecide,
  decided,
  payloadOf,
  type ArtifactPayloadReader,
  type EvaluableArtifact,
  type WorkerEvaluationResult,
} from "@designflow/sdk";
import { ARTIFACT_IDS, accessibilityReviewSchema, qaReportSchema, severityAssessmentSchema } from "./types";

/**
 * The QA Reviewer's first deterministic evaluation layer.
 *
 * Every check here reads only what it is handed — the artifact list and (for
 * structural checks) artifact payloads supplied through `getArtifactPayload`.
 * Nothing here calls a model, opens a network connection, or reasons about
 * text; a criterion that genuinely needs judgment is reported as
 * `satisfied: undefined` with a `note` explaining why, which is correct
 * behaviour, not an unfinished check.
 */
export function evaluateQaReviewerCriterion(
  criterionId: string,
  artifacts: readonly EvaluableArtifact[],
  getArtifactPayload: ArtifactPayloadReader | undefined,
): WorkerEvaluationResult {
  switch (criterionId) {
    case "findings-have-severity": {
      const payload = payloadOf(artifacts, ARTIFACT_IDS.severityAssessment, getArtifactPayload);
      if (payload === undefined) {
        return decided(criterionId, false, "No severity assessment artifact was found");
      }

      const parsed = severityAssessmentSchema.safeParse(payload);
      if (parsed.success) {
        return decided(criterionId, true);
      }

      const rawIssues =
        typeof payload === "object" && payload !== null && Array.isArray((payload as { issues?: unknown }).issues)
          ? ((payload as { issues: unknown[] }).issues)
          : undefined;

      if (rawIssues === undefined) {
        return decided(criterionId, false, "Severity assessment artifact is malformed: no issues array");
      }

      const missingSeverity = rawIssues.filter(
        (issue) => typeof issue !== "object" || issue === null || !("severity" in issue),
      ).length;

      return decided(
        criterionId,
        missingSeverity === 0,
        missingSeverity === 0
          ? undefined
          : `${missingSeverity} of ${rawIssues.length} issue(s) are missing a severity level`,
      );
    }

    case "accessibility-category-covered": {
      const payload = payloadOf(artifacts, ARTIFACT_IDS.accessibilityReview, getArtifactPayload);
      if (payload === undefined) {
        return decided(criterionId, false, "No accessibility review artifact was found");
      }

      const parsed = accessibilityReviewSchema.safeParse(payload);
      if (!parsed.success) {
        return decided(criterionId, false, "Accessibility review artifact does not match the workflow's own schema");
      }

      return decided(
        criterionId,
        parsed.data.findings.length > 0,
        parsed.data.findings.length > 0 ? undefined : "No accessibility findings were reported",
      );
    }

    case "report-internally-consistent": {
      const assessmentPayload = payloadOf(artifacts, ARTIFACT_IDS.severityAssessment, getArtifactPayload);
      const reportPayload = payloadOf(artifacts, ARTIFACT_IDS.qaReport, getArtifactPayload);

      if (assessmentPayload === undefined || reportPayload === undefined) {
        return decided(criterionId, false, "Severity assessment or QA report artifact is missing");
      }

      const assessment = severityAssessmentSchema.safeParse(assessmentPayload);
      const report = qaReportSchema.safeParse(reportPayload);

      if (!assessment.success || !report.success) {
        return decided(criterionId, false, "Severity assessment or QA report artifact does not match its schema");
      }

      const countsMatch =
        JSON.stringify(assessment.data.counts) === JSON.stringify(report.data.severityCounts) &&
        assessment.data.issues.length === report.data.issueCount &&
        assessment.data.flaggedIssueIds.length === report.data.flaggedIssueCount;

      return decided(
        criterionId,
        countsMatch,
        countsMatch ? undefined : "Severity counts in the QA report do not match the severity assessment",
      );
    }

    default:
      return cannotDecide(criterionId, `No deterministic evaluator is implemented for "${criterionId}"`);
  }
}
