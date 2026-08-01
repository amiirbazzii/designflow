// workflows/workflow-research-analysis/src/evaluate.ts
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
  comparisonMatrixSchema,
  extractedClaimsSchema,
  researchBriefSchema,
  sourceInventorySchema,
} from "./types";

/**
 * The Research Analyst's first deterministic evaluation layer.
 *
 * Every check here reads only what it is handed — the artifact list and (for
 * structural checks) artifact payloads supplied through `getArtifactPayload`.
 * Nothing here calls a model, opens a network connection, or reasons about
 * text; a criterion that genuinely needs judgment is reported as
 * `satisfied: undefined` with a `note` explaining why, which is correct
 * behaviour, not an unfinished check.
 */
export function evaluateResearchAnalystCriterion(
  criterionId: string,
  artifacts: readonly EvaluableArtifact[],
  getArtifactPayload: ArtifactPayloadReader | undefined,
): WorkerEvaluationResult {
  switch (criterionId) {
    case "claims-linked-to-sources":
    case "unsupported-claims-flagged": {
      const claimsPayload = payloadOf(artifacts, ARTIFACT_IDS.extractedClaims, getArtifactPayload);
      const inventoryPayload = payloadOf(artifacts, ARTIFACT_IDS.sourceInventory, getArtifactPayload);

      if (claimsPayload === undefined) {
        return criterionId === "unsupported-claims-flagged"
          ? { criterionId, satisfied: false, note: "No extracted claims artifact was found" }
          : decided(criterionId, false, "No extracted claims artifact was found");
      }

      const claims = extractedClaimsSchema.safeParse(claimsPayload);
      if (!claims.success) {
        return criterionId === "unsupported-claims-flagged"
          ? { criterionId, satisfied: false, note: "Extracted claims artifact does not match the workflow's own schema" }
          : decided(criterionId, false, "Extracted claims artifact does not match the workflow's own schema");
      }

      const validSourceIds = new Set<string>();
      if (inventoryPayload !== undefined) {
        const inventory = sourceInventorySchema.safeParse(inventoryPayload);
        if (inventory.success) {
          for (const source of inventory.data.validSources) validSourceIds.add(source.id);
        }
      }

      const unsupported = claims.data.claims.filter(
        (claim) =>
          claim.sourceId.length === 0 || (validSourceIds.size > 0 && !validSourceIds.has(claim.sourceId)),
      );

      if (criterionId === "unsupported-claims-flagged") {
        return {
          criterionId,
          value: unsupported.length,
          satisfied: unsupported.length === 0,
          ...(unsupported.length > 0
            ? { note: `${unsupported.length} of ${claims.data.claims.length} claim(s) lack a valid supplied source id` }
            : {}),
        };
      }

      return decided(
        criterionId,
        unsupported.length === 0,
        unsupported.length === 0
          ? undefined
          : `${unsupported.length} of ${claims.data.claims.length} claim(s) do not cite a supplied source`,
      );
    }

    case "conflicting-findings-identified": {
      const matrixPayload = payloadOf(artifacts, ARTIFACT_IDS.comparisonMatrix, getArtifactPayload);
      const briefPayload = payloadOf(artifacts, ARTIFACT_IDS.researchBrief, getArtifactPayload);

      if (matrixPayload === undefined || briefPayload === undefined) {
        return decided(criterionId, false, "Comparison matrix or research brief artifact is missing");
      }

      const matrix = comparisonMatrixSchema.safeParse(matrixPayload);
      const brief = researchBriefSchema.safeParse(briefPayload);

      if (!matrix.success || !brief.success) {
        return decided(criterionId, false, "Comparison matrix or research brief artifact does not match its schema");
      }

      const hasConflictGroup = matrix.data.groups.some((group) => group.agreement === "conflict");
      if (!hasConflictGroup) {
        return decided(criterionId, true, "No conflicting source groups were found, so there was nothing to flag");
      }

      return decided(
        criterionId,
        brief.data.conflicts.length > 0,
        brief.data.conflicts.length > 0
          ? undefined
          : "Conflicting source groups exist but the research brief flags no conflicts",
      );
    }

    default:
      return cannotDecide(criterionId, `No deterministic evaluator is implemented for "${criterionId}"`);
  }
}
