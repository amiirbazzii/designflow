// workflows/workflow-design-to-code/src/evaluate.ts
import {
  cannotDecide,
  decided,
  isPresent,
  payloadOf,
  type ArtifactPayloadReader,
  type EvaluableArtifact,
  type WorkerEvaluationResult,
} from "@designflow/sdk";
import { ARTIFACT_IDS, validationReportSchema } from "./types";

/**
 * The Design Engineer's first deterministic evaluation layer.
 *
 * Every check here reads only what it is handed — the artifact list and (for
 * structural checks) artifact payloads supplied through `getArtifactPayload`.
 * Nothing here calls a model, opens a network connection, or reasons about
 * text; a criterion that genuinely needs judgment is reported as
 * `satisfied: undefined` with a `note` explaining why, which is correct
 * behaviour, not an unfinished check.
 */
export function evaluateDesignEngineerCriterion(
  criterionId: string,
  artifacts: readonly EvaluableArtifact[],
  getArtifactPayload: ArtifactPayloadReader | undefined,
): WorkerEvaluationResult {
  switch (criterionId) {
    case "output-validates": {
      const payload = payloadOf(artifacts, ARTIFACT_IDS.validationReport, getArtifactPayload);
      if (payload === undefined) {
        return decided(criterionId, false, "No validation report artifact was found");
      }

      const parsed = validationReportSchema.safeParse(payload);
      if (!parsed.success) {
        return decided(criterionId, false, "Validation report artifact does not match the workflow's own schema");
      }

      return decided(
        criterionId,
        parsed.data.passed,
        parsed.data.passed ? undefined : `Validation reported ${parsed.data.issues.length} issue(s)`,
      );
    }

    case "expected-artifacts-produced": {
      const required = Object.values(ARTIFACT_IDS);
      const missing = required.filter((id) => !isPresent(artifacts, id));
      return decided(
        criterionId,
        missing.length === 0,
        missing.length === 0 ? undefined : `Missing artifact(s): ${missing.join(", ")}`,
      );
    }

    case "design-system-reuse-detected":
      return cannotDecide(
        criterionId,
        "No artifact records whether a component was matched against an existing approved design system — this cannot be decided from the data available deterministically",
      );

    default:
      return cannotDecide(criterionId, `No deterministic evaluator is implemented for "${criterionId}"`);
  }
}
