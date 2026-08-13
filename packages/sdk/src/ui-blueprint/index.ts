// packages/sdk/src/ui-blueprint/index.ts
//
// The canonical UI Blueprint contracts (Agent Architecture V2).
//
//   blueprint-schema.ts       compiler-owned design FACTS + the Blueprint itself
//   semantic-patch-schema.ts  the model-authored SEMANTICS a patch may carry
//
// The split is the architecture: a patch schema that cannot express a
// dimension is what makes "AI cannot rewrite design facts" a property of the
// types rather than a rule someone has to enforce.
export {
  UI_BLUEPRINT_SCHEMA_VERSION,
  UI_BLUEPRINT_ARTIFACT_IDS,
  UI_BLUEPRINT_ARTIFACT_TYPES,
  blueprintBoundSchema,
  blueprintTypographySchema,
  blueprintLayoutSchema,
  blueprintStyleSchema,
  blueprintElementFactsSchema,
  blueprintElementRoleSchema,
  blueprintInteractionKindSchema,
  blueprintEvidenceBasisSchema,
  blueprintImportanceSchema,
  blueprintSemanticsSchema,
  blueprintElementSchema,
  blueprintComponentPropertySchema,
  blueprintComponentInstanceSchema,
  blueprintComponentSchema,
  blueprintFoundationValueSchema,
  blueprintFoundationsSchema,
  blueprintAssetSchema,
  blueprintInteractionSchema,
  blueprintSemanticRegionSchema,
  blueprintRelationshipKindSchema,
  blueprintRelationshipSchema,
  blueprintUncertaintySchema,
  blueprintScreenSchema,
  blueprintProvenanceSchema,
  blueprintEnrichmentStatusSchema,
  blueprintEnrichmentSchema,
  uiBlueprintSchema,
} from "./blueprint-schema";

export type {
  BlueprintBound,
  BlueprintTypography,
  BlueprintLayout,
  BlueprintStyle,
  BlueprintElementFacts,
  BlueprintElementRole,
  BlueprintInteractionKind,
  BlueprintEvidenceBasis,
  BlueprintSemantics,
  BlueprintElement,
  BlueprintComponent,
  BlueprintFoundations,
  BlueprintSemanticRegion,
  BlueprintRelationship,
  BlueprintUncertainty,
  BlueprintScreen,
  BlueprintProvenance,
  BlueprintEnrichment,
  BlueprintEnrichmentStatus,
  UIBlueprint,
} from "./blueprint-schema";

export {
  UI_SEMANTIC_PATCH_SCHEMA_VERSION,
  BLUEPRINT_FACT_FIELD_NAMES,
  uiSemanticElementAnnotationSchema,
  uiSemanticComponentAnnotationSchema,
  uiSemanticRegionAnnotationSchema,
  uiSemanticRelationshipSchema,
  uiSemanticPatchSchema,
} from "./semantic-patch-schema";

export type { UISemanticPatch } from "./semantic-patch-schema";
