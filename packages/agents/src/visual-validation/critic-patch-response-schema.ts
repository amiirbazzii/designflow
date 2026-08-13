// packages/agents/src/visual-validation/critic-patch-response-schema.ts
import type { JsonSchemaObject } from "@designflow/sdk";

const text = { type: "string" } as const;

/**
 * The provider-facing wire shape for one Visual Critic patch.
 *
 * The same portable strict subset every other V2 agent uses — flat closed
 * objects, every property required, nullable scalars only, no combinators —
 * because a deep or exotic schema is rejected at the gateway by every
 * candidate model at once.
 *
 * Note what has no field here: no measurement, no expected or actual value,
 * no bounding box, no new finding. The model answers about `findingId`s the
 * host minted from real browser evidence, so an observation it imagined has
 * nowhere to go.
 */
export const criticPatchResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    annotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          findingId: text,
          severity: { type: ["string", "null"], enum: ["info", "minor", "major", "critical", null] },
          priority: { type: ["integer", "null"] },
          userVisibleImpact: { type: ["string", "null"] },
          likelyCauseCategory: {
            type: ["string", "null"],
            enum: ["styling", "layout", "component-choice", "content", "composition", "unknown", null],
          },
          repairGuidance: { type: ["string", "null"] },
        },
        required: ["findingId", "severity", "priority", "userVisibleImpact", "likelyCauseCategory", "repairGuidance"],
      },
    },
    summary: { type: ["string", "null"] },
    inconclusive: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { findingId: text, reason: text },
        required: ["findingId", "reason"],
      },
    },
  },
  required: ["annotations", "summary", "inconclusive"],
};
