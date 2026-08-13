// packages/sdk/src/ui-blueprint/blueprint-schema.ts
import { z } from "zod";

/**
 * The canonical UI Blueprint (Agent Architecture V2, phase V2-1).
 *
 * DesignFlow's source of design truth. Everything downstream of Figma — the
 * human-readable Specification, and in later phases the Project Mapper and UI
 * Builder — reads this, rather than re-interpreting a prose document written
 * by a model.
 *
 * The whole contract is built around one separation:
 *
 *   facts      compiled deterministically from normalized Figma evidence.
 *              A width, a hex color, a radius, an exact string. Owned by the
 *              compiler. No model can author or change one.
 *
 *   semantics  what those facts *mean* for an implementer — this frame is the
 *              page header, this text field takes the amount, these five
 *              items are the bottom navigation. Judgment, and the only thing
 *              a model may contribute.
 *
 * The separation is structural rather than advisory: semantics live in their
 * own strict objects with no numeric/style/text fields to write into, so the
 * semantic patch schema is physically unable to express "height = 72" or
 * "text = something else". A model that tries produces a schema failure, not
 * a corrupted design fact.
 *
 * A Blueprint with no semantics at all is still a valid Blueprint. Semantic
 * enrichment is additive, bounded, and allowed to fail — if the interpreter
 * model is unavailable the design facts are unaffected, and the artifact says
 * so rather than pretending the enrichment happened.
 */

export const UI_BLUEPRINT_SCHEMA_VERSION = "1";

/** Artifact ids/types for the V2 design pipeline. Wiring lands with V2-2. */
export const UI_BLUEPRINT_ARTIFACT_IDS = {
  draft: "ui-blueprint-draft",
  patch: "ui-semantic-patch",
  blueprint: "ui-blueprint",
} as const;

export const UI_BLUEPRINT_ARTIFACT_TYPES = {
  draft: "design.ui-blueprint-draft",
  patch: "design.ui-semantic-patch",
  blueprint: "design.ui-blueprint",
} as const;

// ── Bounded collections ─────────────────────────────────────────

/**
 * What a bound dropped, whenever one did.
 *
 * A truncated collection that says nothing reads exactly like a complete one,
 * which is how "the design was fully covered" becomes a lie. Every bounded
 * collection in the Blueprint records what it started with, what it kept and
 * why.
 */
export const blueprintBoundSchema = z
  .object({
    collection: z.string().min(1).max(80),
    originalCount: z.number().int().nonnegative(),
    retainedCount: z.number().int().nonnegative(),
    reason: z.string().min(1).max(200),
  })
  .strict();

export type BlueprintBound = z.infer<typeof blueprintBoundSchema>;

// ── Compiler-owned facts ────────────────────────────────────────

export const blueprintTypographySchema = z
  .object({
    fontFamily: z.string().min(1).max(120).optional(),
    fontStyle: z.string().min(1).max(80).optional(),
    fontSizePx: z.number().nonnegative().optional(),
    lineHeight: z.string().min(1).max(40).optional(),
    letterSpacing: z.string().min(1).max(40).optional(),
    textAlign: z.string().min(1).max(40).optional(),
  })
  .strict();

export type BlueprintTypography = z.infer<typeof blueprintTypographySchema>;

export const blueprintLayoutSchema = z
  .object({
    direction: z.enum(["horizontal", "vertical"]).optional(),
    gapPx: z.number().nonnegative().optional(),
    paddingTopPx: z.number().nonnegative().optional(),
    paddingRightPx: z.number().nonnegative().optional(),
    paddingBottomPx: z.number().nonnegative().optional(),
    paddingLeftPx: z.number().nonnegative().optional(),
    mainAxisAlign: z.string().min(1).max(60).optional(),
    crossAxisAlign: z.string().min(1).max(60).optional(),
    sizingHorizontal: z.string().min(1).max(40).optional(),
    sizingVertical: z.string().min(1).max(40).optional(),
  })
  .strict();

export type BlueprintLayout = z.infer<typeof blueprintLayoutSchema>;

export const blueprintStyleSchema = z
  .object({
    background: z.string().min(1).max(60).optional(),
    border: z.string().min(1).max(60).optional(),
    radiusPx: z.number().nonnegative().optional(),
    opacity: z.number().min(0).max(1).optional(),
    effects: z.array(z.string().min(1).max(120)).max(12).default([]),
  })
  .strict();

export type BlueprintStyle = z.infer<typeof blueprintStyleSchema>;

/**
 * One element's deterministic facts. Every field here is compiled from
 * normalized Figma evidence and is never model-authored.
 */
export const blueprintElementFactsSchema = z
  .object({
    /** The real Figma node id this element was compiled from. */
    sourceNodeId: z.string().min(1).max(200),
    name: z.string().min(1).max(200).optional(),
    nodeType: z.string().min(1).max(60).optional(),
    /** Exact visible copy, verbatim. */
    text: z.string().max(2000).optional(),
    widthPx: z.number().nonnegative().optional(),
    heightPx: z.number().nonnegative().optional(),
    layout: blueprintLayoutSchema.optional(),
    style: blueprintStyleSchema.optional(),
    typography: blueprintTypographySchema.optional(),
    textColor: z.string().min(1).max(60).optional(),
    /** Blueprint asset id, when this element renders one. */
    assetRef: z.string().min(1).max(200).optional(),
    /** Blueprint component id, when this element is a component instance. */
    componentRef: z.string().min(1).max(200).optional(),
    /** Evidenced Figma component property values on this instance. */
    propertyValues: z.record(z.string().max(200)).optional(),
    /** States the evidence actually shows (never inferred ones). */
    observedStates: z.array(z.string().min(1).max(120)).max(12).default([]),
  })
  .strict();

export type BlueprintElementFacts = z.infer<typeof blueprintElementFactsSchema>;

// ── Semantic vocabulary (the only thing a model may write) ──────

export const blueprintElementRoleSchema = z.enum([
  "header",
  "heading",
  "body_text",
  "form",
  "form_control",
  "action",
  "tabs",
  "navigation",
  "list",
  "list_item",
  "card",
  "icon",
  "image",
  "container",
  "unknown",
]);

export type BlueprintElementRole = z.infer<typeof blueprintElementRoleSchema>;

export const blueprintInteractionKindSchema = z.enum([
  "none",
  "text_entry",
  "selection",
  "navigation",
  "submit",
  "toggle",
  "tab_switch",
  "pagination",
  "unknown",
]);

export type BlueprintInteractionKind = z.infer<typeof blueprintInteractionKindSchema>;

/**
 * Where an annotation came from.
 *
 * `explicit_design_evidence` and `component_metadata` are grounded in the
 * snapshot; the two `*_inference` values are the model's judgment. Keeping
 * them in one enum on every annotation is what stops an inference being read
 * later as a Figma fact.
 */
export const blueprintEvidenceBasisSchema = z.enum([
  "explicit_design_evidence",
  "component_metadata",
  "visual_inference",
  "semantic_inference",
]);

export type BlueprintEvidenceBasis = z.infer<typeof blueprintEvidenceBasisSchema>;

export const blueprintImportanceSchema = z.enum(["primary", "secondary", "supporting"]);

/**
 * The semantic annotation surface. Deliberately has no field capable of
 * carrying a dimension, color, string of copy, or variant — a model cannot
 * express a design fact here even if it tries.
 */
export const blueprintSemanticsSchema = z
  .object({
    role: blueprintElementRoleSchema.optional(),
    /** Short implementation-oriented meaning, e.g. `amount_input`. */
    purpose: z.string().min(1).max(120).optional(),
    interactionKind: blueprintInteractionKindSchema.optional(),
    importance: blueprintImportanceSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidenceBasis: blueprintEvidenceBasisSchema.optional(),
    notes: z.array(z.string().min(1).max(240)).max(4).default([]),
  })
  .strict();

export type BlueprintSemantics = z.infer<typeof blueprintSemanticsSchema>;

// ── Blueprint entities ──────────────────────────────────────────

export const blueprintElementSchema = z
  .object({
    /** Stable identity: the source node id, so every reference is traceable. */
    id: z.string().min(1).max(200),
    parentId: z.string().min(1).max(200).optional(),
    /** Position among siblings — the visual/source order, preserved exactly. */
    order: z.number().int().nonnegative(),
    facts: blueprintElementFactsSchema,
    semantics: blueprintSemanticsSchema.default({ notes: [] }),
  })
  .strict();

export type BlueprintElement = z.infer<typeof blueprintElementSchema>;

export const blueprintComponentPropertySchema = z
  .object({
    name: z.string().min(1).max(120),
    values: z.array(z.string().min(1).max(200)).max(24).default([]),
    source: z.enum(["observedInSelection", "declaredByFigmaComponentMetadata"]),
  })
  .strict();

export const blueprintComponentInstanceSchema = z
  .object({
    /** The Blueprint element this instance is rendered by. */
    elementId: z.string().min(1).max(200),
    sourceNodeId: z.string().min(1).max(200),
    name: z.string().min(1).max(200).optional(),
    propertyValues: z.record(z.string().max(200)).optional(),
    /** Exact per-instance content/slot facts, in source order. */
    contents: z
      .array(
        z
          .object({
            sourceNodeId: z.string().min(1).max(200),
            name: z.string().min(1).max(200).optional(),
            nodeType: z.string().min(1).max(60).optional(),
            depth: z.number().int().nonnegative(),
            text: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    /** Facts that differ from the component's shared baseline. */
    differences: z.array(z.string().min(1).max(200)).max(24).default([]),
  })
  .strict();

export const blueprintComponentSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    /** Figma identity when the transport exposed it. */
    figmaComponentId: z.string().min(1).max(200).optional(),
    componentSetId: z.string().min(1).max(200).optional(),
    properties: z.array(blueprintComponentPropertySchema).max(24).default([]),
    declaredVariants: z.array(z.string().min(1).max(200)).max(48).default([]),
    observedVariants: z.array(z.string().min(1).max(200)).max(48).default([]),
    anatomy: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            nodeType: z.string().min(1).max(60).optional(),
            depth: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(64)
      .default([]),
    sharedFacts: z
      .object({
        widthPx: z.number().nonnegative().optional(),
        heightPx: z.number().nonnegative().optional(),
        style: blueprintStyleSchema.optional(),
        layout: blueprintLayoutSchema.optional(),
      })
      .strict()
      .default({}),
    instances: z.array(blueprintComponentInstanceSchema).max(64).default([]),
    semantics: blueprintSemanticsSchema.default({ notes: [] }),
  })
  .strict();

export type BlueprintComponent = z.infer<typeof blueprintComponentSchema>;

export const blueprintFoundationValueSchema = z
  .object({
    value: z.string().min(1).max(200),
    name: z.string().min(1).max(200).optional(),
    source: z.enum(["figma-variable", "observed-value"]),
  })
  .strict();

export const blueprintFoundationsSchema = z
  .object({
    colors: z.array(blueprintFoundationValueSchema).max(96).default([]),
    typography: z.array(blueprintFoundationValueSchema).max(64).default([]),
    spacing: z.array(blueprintFoundationValueSchema).max(64).default([]),
    radii: z.array(blueprintFoundationValueSchema).max(32).default([]),
    borders: z.array(blueprintFoundationValueSchema).max(32).default([]),
    effects: z.array(blueprintFoundationValueSchema).max(32).default([]),
  })
  .strict();

export type BlueprintFoundations = z.infer<typeof blueprintFoundationsSchema>;

export const blueprintAssetSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    type: z.string().min(1).max(60),
    reference: z.string().min(1).max(500).optional(),
    sourceNodeId: z.string().min(1).max(200).optional(),
  })
  .strict();

export const blueprintInteractionSchema = z
  .object({
    sourceNodeId: z.string().min(1).max(200),
    description: z.string().min(1).max(300),
  })
  .strict();

/**
 * A named group of existing Blueprint elements — the implementation-oriented
 * page anatomy. A region never introduces a node: every member must already
 * exist, and its id is derived deterministically at merge time.
 */
export const blueprintSemanticRegionSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(160),
    order: z.number().int().nonnegative(),
    memberElementIds: z.array(z.string().min(1).max(200)).min(1).max(256),
    /** Set when the region maps exactly onto one evidenced container. */
    anchorElementId: z.string().min(1).max(200).optional(),
    origin: z.enum(["compiler", "interpreter"]),
    semantics: blueprintSemanticsSchema.default({ notes: [] }),
  })
  .strict();

export type BlueprintSemanticRegion = z.infer<typeof blueprintSemanticRegionSchema>;

export const blueprintRelationshipKindSchema = z.enum([
  "labels",
  "describes",
  "controls",
  "submits",
  "navigates_to",
  "groups",
]);

export const blueprintRelationshipSchema = z
  .object({
    id: z.string().min(1).max(220),
    kind: blueprintRelationshipKindSchema,
    fromId: z.string().min(1).max(200),
    toId: z.string().min(1).max(200),
    evidenceBasis: blueprintEvidenceBasisSchema,
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type BlueprintRelationship = z.infer<typeof blueprintRelationshipSchema>;

export const blueprintUncertaintySchema = z
  .object({
    code: z.string().min(1).max(120),
    description: z.string().min(1).max(400),
    affectedIds: z.array(z.string().min(1).max(200)).max(32).default([]),
    requiresUserInput: z.boolean().default(false),
  })
  .strict();

export type BlueprintUncertainty = z.infer<typeof blueprintUncertaintySchema>;

// ── Screen, provenance, enrichment status ───────────────────────

export const blueprintScreenSchema = z
  .object({
    rootElementId: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    widthPx: z.number().nonnegative().optional(),
    heightPx: z.number().nonnegative().optional(),
    background: z.string().min(1).max(60).optional(),
    layout: blueprintLayoutSchema.optional(),
    scrolls: z.boolean().optional(),
  })
  .strict();

export type BlueprintScreen = z.infer<typeof blueprintScreenSchema>;

export const blueprintProvenanceSchema = z
  .object({
    designFile: z.string().min(1).max(1000),
    fileKey: z.string().min(1).max(200).optional(),
    documentVersion: z.string().min(1).max(200).optional(),
    rootNodeIds: z.array(z.string().min(1).max(200)).max(32).default([]),
    /** The persisted evidence artifact this Blueprint was compiled from. */
    snapshotArtifactId: z.string().min(1).max(200).optional(),
    compilerVersion: z.string().min(1).max(40),
    bounds: z.array(blueprintBoundSchema).max(24).default([]),
  })
  .strict();

export type BlueprintProvenance = z.infer<typeof blueprintProvenanceSchema>;

export const blueprintEnrichmentStatusSchema = z.enum([
  "not_requested",
  "completed",
  "partial",
  "unavailable",
]);

export type BlueprintEnrichmentStatus = z.infer<typeof blueprintEnrichmentStatusSchema>;

export const blueprintEnrichmentSchema = z
  .object({
    status: blueprintEnrichmentStatusSchema,
    /** Partitions the compiler asked for. */
    partitionCount: z.number().int().nonnegative().default(0),
    /** Patches that validated and merged. */
    patchCount: z.number().int().nonnegative().default(0),
    modelProvenance: z
      .object({
        agentId: z.string().min(1).max(120),
        agentVersion: z.string().min(1).max(40),
        modelProfileId: z.string().min(1).max(120),
        model: z.string().min(1).max(160).optional(),
      })
      .strict()
      .optional(),
    /** Which partitions failed, with a stable code — never a prompt or output. */
    failures: z
      .array(
        z
          .object({
            partitionId: z.string().min(1).max(160),
            code: z.string().min(1).max(120),
          })
          .strict(),
      )
      .max(32)
      .default([]),
  })
  .strict();

export type BlueprintEnrichment = z.infer<typeof blueprintEnrichmentSchema>;

// ── The Blueprint ───────────────────────────────────────────────

export const uiBlueprintSchema = z
  .object({
    schemaVersion: z.literal(UI_BLUEPRINT_SCHEMA_VERSION),
    screen: blueprintScreenSchema,
    elements: z.array(blueprintElementSchema).max(2000).default([]),
    components: z.array(blueprintComponentSchema).max(128).default([]),
    foundations: blueprintFoundationsSchema,
    assets: z.array(blueprintAssetSchema).max(128).default([]),
    interactions: z.array(blueprintInteractionSchema).max(128).default([]),
    semanticRegions: z.array(blueprintSemanticRegionSchema).max(64).default([]),
    relationships: z.array(blueprintRelationshipSchema).max(256).default([]),
    uncertainties: z.array(blueprintUncertaintySchema).max(64).default([]),
    semanticEnrichment: blueprintEnrichmentSchema,
    provenance: blueprintProvenanceSchema,
  })
  .strict();

export type UIBlueprint = z.infer<typeof uiBlueprintSchema>;
