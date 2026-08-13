// packages/sdk/src/ui-blueprint/semantic-patch-schema.ts
import { z } from "zod";
import {
  blueprintElementRoleSchema,
  blueprintEvidenceBasisSchema,
  blueprintImportanceSchema,
  blueprintInteractionKindSchema,
  blueprintRelationshipKindSchema,
  blueprintUncertaintySchema,
} from "./blueprint-schema";

/**
 * The semantic patch — the only thing a model may contribute to a Blueprint.
 *
 * Deliberately the smallest contract in the product. It can name an existing
 * entity and say what that entity *means*; it has no property capable of
 * carrying a dimension, color, radius, typeface, variant or line of copy, so
 * a model cannot restate — or corrupt — a compiled design fact through it.
 * That is the fact/semantics boundary expressed as a type rather than a rule.
 */

export const UI_SEMANTIC_PATCH_SCHEMA_VERSION = "1";


const patchAnnotationSchema = z
  .object({
    role: blueprintElementRoleSchema.optional(),
    purpose: z.string().min(1).max(120).optional(),
    interactionKind: blueprintInteractionKindSchema.optional(),
    importance: blueprintImportanceSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidenceBasis: blueprintEvidenceBasisSchema.optional(),
    notes: z.array(z.string().min(1).max(240)).max(4).default([]),
  })
  .strict();

export const uiSemanticElementAnnotationSchema = patchAnnotationSchema
  .extend({ elementId: z.string().min(1).max(200) })
  .strict();

export const uiSemanticComponentAnnotationSchema = patchAnnotationSchema
  .extend({ componentId: z.string().min(1).max(200) })
  .strict();

/**
 * A region proposal. The interpreter supplies a name and the existing member
 * elements; the merge derives the id, so a patch can never mint a node.
 */
export const uiSemanticRegionAnnotationSchema = patchAnnotationSchema
  .extend({
    name: z.string().min(1).max(160),
    memberElementIds: z.array(z.string().min(1).max(200)).min(1).max(256),
    anchorElementId: z.string().min(1).max(200).optional(),
  })
  .strict();

export const uiSemanticRelationshipSchema = z
  .object({
    kind: blueprintRelationshipKindSchema,
    fromId: z.string().min(1).max(200),
    toId: z.string().min(1).max(200),
    evidenceBasis: blueprintEvidenceBasisSchema,
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export const uiSemanticPatchSchema = z
  .object({
    schemaVersion: z.literal(UI_SEMANTIC_PATCH_SCHEMA_VERSION),
    /** Which deterministic partition this patch answers. */
    partitionId: z.string().min(1).max(160),
    elementAnnotations: z.array(uiSemanticElementAnnotationSchema).max(256).default([]),
    componentAnnotations: z.array(uiSemanticComponentAnnotationSchema).max(64).default([]),
    regionAnnotations: z.array(uiSemanticRegionAnnotationSchema).max(32).default([]),
    relationships: z.array(uiSemanticRelationshipSchema).max(128).default([]),
    uncertainties: z.array(blueprintUncertaintySchema).max(32).default([]),
  })
  .strict();

export type UISemanticPatch = z.infer<typeof uiSemanticPatchSchema>;

/**
 * Field names that carry design facts.
 *
 * The patch schema above is `.strict()` and has none of them, so a patch
 * carrying one is already rejected at parse. This list exists for the merge's
 * own defensive check on raw, not-yet-parsed input — a second lock on the
 * boundary that matters most, and the thing `ERR_BLUEPRINT_PATCH_FACT_OVERRIDE`
 * reports when it fires.
 */
export const BLUEPRINT_FACT_FIELD_NAMES: readonly string[] = Object.freeze([
  "facts",
  "text",
  "characters",
  "width",
  "widthPx",
  "height",
  "heightPx",
  "background",
  "backgroundColor",
  "border",
  "borderColor",
  "radius",
  "radiusPx",
  "cornerRadius",
  "opacity",
  "typography",
  "fontFamily",
  "fontSize",
  "fontSizePx",
  "textColor",
  "layout",
  "spacing",
  "gapPx",
  "padding",
  "effects",
  "assetRef",
  "componentRef",
  "propertyValues",
  "variants",
  "declaredVariants",
  "observedVariants",
  "sourceNodeId",
  "anatomy",
  "sharedFacts",
  "instances",
]);
