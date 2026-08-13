// packages/agents/src/project-mapper/mapping-patch-response-schema.ts
import type { JsonSchemaObject } from "@designflow/sdk";

const text = { type: "string" } as const;
const strings = { type: "array", items: text } as const;

/**
 * The provider-facing wire shape for one mapping patch.
 *
 * The same portable strict subset every other agent uses — flat closed
 * objects, every property required, nullable scalars only, no combinators —
 * because the field taught us that a deep or exotic schema is rejected at the
 * gateway by every candidate model at once.
 *
 * Note what has no field here: a path, a token reference, a route, a file
 * body. The model answers with *ids the host minted*, so a project fact it
 * invented has nowhere to go.
 */
const compatibility = {
  type: "object",
  additionalProperties: false,
  properties: {
    structure: { type: "string", enum: ["compatible", "partial", "incompatible", "unknown"] },
    slots: { type: "string", enum: ["compatible", "partial", "incompatible", "unknown"] },
    states: { type: "string", enum: ["compatible", "partial", "incompatible", "unknown"] },
    visual: { type: "string", enum: ["compatible", "partial", "incompatible", "unknown"] },
    interaction: { type: "string", enum: ["compatible", "partial", "incompatible", "unknown"] },
  },
  required: ["structure", "slots", "states", "visual", "interaction"],
} as const;

export const mappingPatchResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    componentDecisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          requirementId: text,
          action: { type: "string", enum: ["reuse", "extend", "create"] },
          candidateId: { type: ["string", "null"] },
          plannedDirectoryId: { type: ["string", "null"] },
          plannedName: { type: ["string", "null"] },
          compatibility,
          requiredAdaptations: strings,
          reason: text,
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "requirementId",
          "action",
          "candidateId",
          "plannedDirectoryId",
          "plannedName",
          "compatibility",
          "requiredAdaptations",
          "reason",
          "confidence",
        ],
      },
    },
    destinationDecision: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        requirementId: text,
        action: { type: "string", enum: ["use_existing", "create_route", "create_page", "integrate_existing_root"] },
        candidateId: text,
        compositionRootCandidateId: { type: ["string", "null"] },
        reason: text,
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["requirementId", "action", "candidateId", "compositionRootCandidateId", "reason", "confidence"],
    },
    styleDecisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          designValue: text,
          category: text,
          strategy: { type: "string", enum: ["reuse_token", "reuse_style", "raw_design_value", "extend_token"] },
          projectTokenId: { type: ["string", "null"] },
          equivalence: { type: ["string", "null"], enum: ["exact", "within-tolerance", null] },
          reason: text,
        },
        required: ["designValue", "category", "strategy", "projectTokenId", "equivalence", "reason"],
      },
    },
    assetDecisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          requirementId: text,
          strategy: {
            type: "string",
            enum: [
              "reuse_project_asset",
              "reuse_project_icon",
              "use_design_asset",
              "create_local_asset",
              "runtime_reference",
              "unresolved",
            ],
          },
          projectAssetId: { type: ["string", "null"] },
          reason: text,
        },
        required: ["requirementId", "strategy", "projectAssetId", "reason"],
      },
    },
    compositionDecisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          blueprintRef: text,
          order: { type: "integer", minimum: 0 },
          componentRequirementId: { type: ["string", "null"] },
          childRefs: strings,
        },
        required: ["blueprintRef", "order", "componentRequirementId", "childRefs"],
      },
    },
    uncertainties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: text,
          description: text,
          requirementIds: strings,
          requiresUserInput: { type: "boolean" },
        },
        required: ["code", "description", "requirementIds", "requiresUserInput"],
      },
    },
  },
  required: [
    "componentDecisions",
    "destinationDecision",
    "styleDecisions",
    "assetDecisions",
    "compositionDecisions",
    "uncertainties",
  ],
};
