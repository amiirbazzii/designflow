// workflows/workflow-product-brief/src/evaluate.ts
import {
  cannotDecide,
  decided,
  payloadOf,
  type ArtifactPayloadReader,
  type EvaluableArtifact,
  type WorkerEvaluationResult,
} from "@designflow/sdk";
import {
  ARTIFACT_IDS,
  acceptanceCriteriaSchema,
  problemStatementSchema,
  requirementsSchema,
  riskAssumptionRegisterSchema,
  scopeDefinitionSchema,
} from "./types";

/**
 * The Product Manager's first deterministic evaluation layer.
 *
 * Every check here reads only what it is handed — the artifact list and (for
 * structural checks) artifact payloads supplied through `getArtifactPayload`.
 * Nothing here calls a model, opens a network connection, or reasons about
 * text; a criterion that genuinely needs judgment is reported as
 * `satisfied: undefined` with a `note` explaining why, which is correct
 * behaviour, not an unfinished check.
 */
export function evaluateProductManagerCriterion(
  criterionId: string,
  artifacts: readonly EvaluableArtifact[],
  getArtifactPayload: ArtifactPayloadReader | undefined,
): WorkerEvaluationResult {
  switch (criterionId) {
    case "user-problem-defined": {
      const payload = payloadOf(artifacts, ARTIFACT_IDS.problemStatement, getArtifactPayload);
      if (payload === undefined) {
        return decided(criterionId, false, "No problem statement artifact was found");
      }

      const parsed = problemStatementSchema.safeParse(payload);
      if (!parsed.success) {
        return decided(criterionId, false, "Problem statement artifact does not match the workflow's own schema");
      }

      const satisfied = parsed.data.targetUser.trim().length > 0 && parsed.data.problem.trim().length > 0;
      return decided(criterionId, satisfied, satisfied ? undefined : "Target user or problem is empty");
    }

    case "acceptance-criteria-measurable": {
      const requirementsPayload = payloadOf(artifacts, ARTIFACT_IDS.requirements, getArtifactPayload);
      const criteriaPayload = payloadOf(artifacts, ARTIFACT_IDS.acceptanceCriteria, getArtifactPayload);

      if (requirementsPayload === undefined || criteriaPayload === undefined) {
        return decided(criterionId, false, "Requirements or acceptance criteria artifact is missing");
      }

      const requirements = requirementsSchema.safeParse(requirementsPayload);
      const criteria = acceptanceCriteriaSchema.safeParse(criteriaPayload);

      if (!requirements.success || !criteria.success) {
        return decided(criterionId, false, "Requirements or acceptance criteria artifact does not match its schema");
      }

      if (requirements.data.items.length === 0) {
        return decided(criterionId, false, "The brief has no requirements to check");
      }

      const linkedRequirementIds = new Set(
        criteria.data.items.filter((item) => item.measurable).map((item) => item.requirementId),
      );

      const unlinked = requirements.data.items.filter((requirement) => !linkedRequirementIds.has(requirement.id));

      return decided(
        criterionId,
        unlinked.length === 0,
        unlinked.length === 0
          ? undefined
          : `Requirement(s) with no linked, measurable acceptance criterion: ${unlinked.map((r) => r.id).join(", ")}`,
      );
    }

    case "risks-and-exclusions-included": {
      const risksPayload = payloadOf(artifacts, ARTIFACT_IDS.riskAssumptionRegister, getArtifactPayload);
      const scopePayload = payloadOf(artifacts, ARTIFACT_IDS.scopeDefinition, getArtifactPayload);

      if (risksPayload === undefined || scopePayload === undefined) {
        return decided(criterionId, false, "Risk register or scope definition artifact is missing");
      }

      const risks = riskAssumptionRegisterSchema.safeParse(risksPayload);
      const scope = scopeDefinitionSchema.safeParse(scopePayload);

      if (!risks.success || !scope.success) {
        return decided(criterionId, false, "Risk register or scope definition artifact does not match its schema");
      }

      const satisfied = risks.data.items.length > 0 && scope.data.outOfScope.length > 0;
      return decided(
        criterionId,
        satisfied,
        satisfied ? undefined : "The brief is missing a named risk/assumption or an out-of-scope item",
      );
    }

    default:
      return cannotDecide(criterionId, `No deterministic evaluator is implemented for "${criterionId}"`);
  }
}
