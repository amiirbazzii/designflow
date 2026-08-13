import type { JsonSchemaObject } from "@designflow/sdk";

const text = { type: "string" } as const;
const strings = { type: "array", items: text } as const;

/**
 * Provider-facing schemas for the specialized agents.
 *
 * These intentionally contain the required, actionable core of each Zod
 * contract. Optional Zod fields are omitted from the provider schema so a
 * strict JSON-schema provider cannot invent nullable variants or prose-shaped
 * extensions. The agent's Zod parser remains authoritative after the call.
 */
// ── Specification V2 provider wire shapes ────────────────────────
//
// The provider-facing wire schema is a deliberately PORTABLE strict subset:
// flat, closed objects (max object depth 3), every property required,
// optional evidence expressed as ["<type>","null"] scalars only — never
// nullable objects, never enums containing null, never zero-length array
// tricks. The rich internal DesignSpecification artifact is reconstructed
// deterministically from this wire shape by `specification-wire.ts`; the
// wire schema loses no required semantics, only nesting.
const maybeText = { type: ["string", "null"] } as const;

const wireScreenShape = {
  type: "object",
  additionalProperties: false,
  properties: { name: text, width: maybeText, height: maybeText, layoutModel: maybeText, background: maybeText, scrollBehavior: maybeText },
  required: ["name", "width", "height", "layoutModel", "background", "scrollBehavior"],
} as const;

const wireRegionShape = {
  type: "object",
  additionalProperties: false,
  properties: { nodeId: maybeText, name: text, role: maybeText },
  required: ["nodeId", "name", "role"],
} as const;

/**
 * One implementation-relevant element, FLAT: `region` names the anatomy
 * region it belongs to and `parent` names its parent element (null for a
 * region's top-level element). Layout and typography facts are flat nullable
 * scalars; the normalizer folds them back into the structured internal shape.
 */
const wireElementShape = {
  type: "object",
  additionalProperties: false,
  properties: {
    region: text,
    parent: maybeText,
    nodeId: maybeText,
    name: text,
    role: maybeText,
    text: maybeText,
    width: maybeText,
    height: maybeText,
    layoutDirection: maybeText,
    gap: maybeText,
    padding: maybeText,
    align: maybeText,
    justify: maybeText,
    sizing: maybeText,
    position: maybeText,
    background: maybeText,
    border: maybeText,
    radius: maybeText,
    opacity: { type: ["number", "null"] },
    fontFamily: maybeText,
    fontWeight: maybeText,
    fontSize: maybeText,
    lineHeight: maybeText,
    letterSpacing: maybeText,
    textColor: maybeText,
    textAlign: maybeText,
    effects: strings,
    asset: maybeText,
    componentName: maybeText,
    states: strings,
    notes: strings,
  },
  required: ["region", "parent", "nodeId", "name", "role", "text", "width", "height", "layoutDirection", "gap", "padding", "align", "justify", "sizing", "position", "background", "border", "radius", "opacity", "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing", "textColor", "textAlign", "effects", "asset", "componentName", "states", "notes"],
} as const;

const evidenceSource = { type: "string", enum: ["observedInSelection", "declaredByFigmaComponentMetadata"] } as const;

const wireComponentContractShape = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: text,
    componentKey: maybeText,
    componentSetName: maybeText,
    sourceNodeIds: strings,
    anatomy: strings,
    baseStyles: strings,
    componentProperties: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: text, values: strings, source: evidenceSource }, required: ["name", "values", "source"] } },
    variants: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: text, source: evidenceSource }, required: ["name", "source"] } },
    states: strings,
    instances: { type: "array", items: { type: "object", additionalProperties: false, properties: { nodeId: maybeText, label: text, differences: strings }, required: ["nodeId", "label", "differences"] } },
    usedBy: strings,
  },
  required: ["name", "componentKey", "componentSetName", "sourceNodeIds", "anatomy", "baseStyles", "componentProperties", "variants", "states", "instances", "usedBy"],
} as const;

const foundationValues = {
  type: "array",
  items: { type: "object", additionalProperties: false, properties: { value: text, name: maybeText, source: { type: "string", enum: ["figma-variable", "observed-value"] }, usage: maybeText }, required: ["value", "name", "source", "usage"] },
} as const;

export const figmaSpecificationResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["3"] },
    sourceIdentity: { type: "object", additionalProperties: false, properties: { designFile: text }, required: ["designFile"] },
    rootNodeId: maybeText,
    screen: wireScreenShape,
    regions: { type: "array", items: wireRegionShape },
    elements: { type: "array", items: wireElementShape },
    componentContracts: { type: "array", items: wireComponentContractShape },
    foundations: {
      type: "object",
      additionalProperties: false,
      properties: { colors: foundationValues, typography: foundationValues, spacing: foundationValues, radii: foundationValues, borders: foundationValues, shadows: foundationValues, iconSizing: foundationValues },
      required: ["colors", "typography", "spacing", "radii", "borders", "shadows", "iconSizing"],
    },
    assetDetails: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: text, name: text, type: text, reference: maybeText, width: maybeText, height: maybeText, purpose: maybeText }, required: ["id", "name", "type", "reference", "width", "height", "purpose"] } },
    content: strings,
    observedStates: strings,
    inferredBehavior: strings,
    responsiveEvidence: strings,
    interactions: strings,
    states: strings,
    accessibilityNotes: strings,
    layoutBehavior: strings,
    responsiveAssumptions: strings,
    frames: strings,
    ambiguities: { type: "array", items: { type: "object", additionalProperties: false, properties: { code: text, description: text, affectedNodeIds: strings, requiresUserInput: { type: "boolean" } }, required: ["code", "description", "affectedNodeIds", "requiresUserInput"] } },
  },
  required: ["schemaVersion", "sourceIdentity", "rootNodeId", "screen", "regions", "elements", "componentContracts", "foundations", "assetDetails", "content", "observedStates", "inferredBehavior", "responsiveEvidence", "interactions", "states", "accessibilityNotes", "layoutBehavior", "responsiveAssumptions", "frames", "ambiguities"],
};

export const implementationResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    files: { type: "array", items: { type: "object", additionalProperties: false, properties: { path: text, action: { type: "string", enum: ["create", "modify"] }, content: text, reason: text }, required: ["path", "action", "content", "reason"] } },
    assumptions: strings,
    unresolvedItems: strings,
    implementationVersion: text,
    coverageClaims: { type: "array", maxItems: 16, items: { type: "object", additionalProperties: false, properties: { targetId: text, mode: { type: "string", enum: ["proposed_change", "existing_reuse"] }, paths: { type: "array", minItems: 1, maxItems: 8, items: text }, supportingPaths: { type: "array", maxItems: 16, items: text } }, required: ["targetId", "mode", "paths", "supportingPaths"] } },
  },
  required: ["files", "assumptions", "unresolvedItems", "implementationVersion", "coverageClaims"],
};

const visualFindingResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["1"] },
    findingId: text,
    category: { type: "string", enum: ["layout", "spacing", "size", "alignment", "typography", "color", "border", "radius", "shadow", "visibility", "content", "responsive", "overflow", "component-structure", "missing-element", "extra-element", "capture-error"] },
    severity: { type: "string", enum: ["info", "minor", "major", "critical"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    status: { type: "string", enum: ["open", "confirmed", "not-applicable"] },
    explanation: text,
    evidenceReferences: strings,
    origin: { type: "string", enum: ["deterministic", "model-interpreted"] },
  },
  required: ["schemaVersion", "findingId", "category", "severity", "confidence", "status", "explanation", "evidenceReferences", "origin"],
} as const;

export const visualValidationResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: { findings: { type: "array", items: visualFindingResponseSchema }, interpretation: text },
  required: ["findings", "interpretation"],
};

export const visualValidationReportResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallScore: { type: "number", minimum: 0, maximum: 1 },
    threshold: { type: "number", minimum: 0, maximum: 1 },
    passed: { type: "boolean" },
    discrepancies: { type: "array", items: { type: "object", additionalProperties: false, properties: { category: text, severity: { type: "string", enum: ["low", "medium", "high"] }, expected: text, actual: text, recommendation: text }, required: ["category", "severity", "expected", "actual", "recommendation"] } },
    screenshotReferences: strings,
    validationAttempt: { type: "integer", minimum: 1 },
  },
  required: ["overallScore", "threshold", "passed", "discrepancies", "screenshotReferences", "validationAttempt"],
};

const correctionChangeResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["1"] },
    operation: { type: "string", enum: ["modify"] },
    relativePath: text,
    baseFileHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    proposedContentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    proposedContent: text,
    reason: text,
    findingIds: strings,
    evidenceIds: strings,
    expectedMeasurableOutcome: { type: "object", additionalProperties: false, properties: { expected: text, actual: text, delta: { type: "number" } }, required: ["expected", "actual", "delta"] },
    designSystemReferences: strings,
    dependencyChangeRequired: { type: "boolean", enum: [false] },
  },
  required: ["schemaVersion", "operation", "relativePath", "baseFileHash", "proposedContentHash", "proposedContent", "reason", "findingIds", "evidenceIds", "expectedMeasurableOutcome", "designSystemReferences", "dependencyChangeRequired"],
} as const;

export const visualCorrectionResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["1"] },
    plan: { type: "object", additionalProperties: false, properties: { schemaVersion: { type: "string", enum: ["1"] }, iterationNumber: { type: "integer", minimum: 1 }, objective: text, selectedFindingIds: strings, findingToChangeMapping: { type: "array", items: { type: "object", additionalProperties: false, properties: { findingId: text, changeIndexes: { type: "array", items: { type: "integer", minimum: 0 } }, expectedOutcome: text, evidenceIds: strings }, required: ["findingId", "changeIndexes", "expectedOutcome", "evidenceIds"] } }, filesExpectedToChange: strings, filesExpectedToRemainUnchanged: strings, dependencyChanges: strings, validationCommands: strings, visualRevalidationRequirements: { type: "object", additionalProperties: false, properties: { required: { type: "boolean", enum: [true] }, viewports: strings, invalidateOldScreenshots: { type: "boolean", enum: [true] } }, required: ["required", "viewports", "invalidateOldScreenshots"] }, risks: strings, rollbackStatement: text, confidence: { type: "number", minimum: 0, maximum: 1 }, limitations: strings, agent: { type: "object", additionalProperties: false, properties: { id: { type: "string", enum: ["visual-correction-agent"] }, version: text, modelProfileId: text }, required: ["id", "version", "modelProfileId"] }, evidenceReferences: strings }, required: ["schemaVersion", "iterationNumber", "objective", "selectedFindingIds", "findingToChangeMapping", "filesExpectedToChange", "filesExpectedToRemainUnchanged", "dependencyChanges", "validationCommands", "visualRevalidationRequirements", "risks", "rollbackStatement", "confidence", "limitations", "agent", "evidenceReferences"] },
    changes: { type: "array", items: correctionChangeResponseSchema },
    traceIds: strings,
  },
  required: ["schemaVersion", "plan", "changes", "traceIds"],
};

// ── UI Semantic Patch provider wire shape (V2-1) ────────────────
//
// The smallest provider contract in the product, and deliberately so: a patch
// carries meaning only. There is no property here capable of holding a
// dimension, a color, a radius, a font, a variant or a line of copy — a model
// physically cannot restate (or corrupt) a compiled design fact through this
// schema. Same portable strict subset as every other wire schema: flat closed
// objects, every property required, nullable scalars only.
const patchAnnotationProperties = {
  role: {
    type: ["string", "null"],
    enum: [
      "header", "heading", "body_text", "form", "form_control", "action", "tabs",
      "navigation", "list", "list_item", "card", "icon", "image", "container", "unknown", null,
    ],
  },
  purpose: { type: ["string", "null"] },
  interactionKind: {
    type: ["string", "null"],
    enum: [
      "none", "text_entry", "selection", "navigation", "submit", "toggle",
      "tab_switch", "pagination", "unknown", null,
    ],
  },
  importance: { type: ["string", "null"], enum: ["primary", "secondary", "supporting", null] },
  confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
  evidenceBasis: {
    type: ["string", "null"],
    enum: ["explicit_design_evidence", "component_metadata", "visual_inference", "semantic_inference", null],
  },
} as const;

const annotationRequired = ["role", "purpose", "interactionKind", "importance", "confidence", "evidenceBasis"] as const;

export const uiSemanticPatchResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    elementAnnotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { elementId: text, ...patchAnnotationProperties },
        required: ["elementId", ...annotationRequired],
      },
    },
    componentAnnotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { componentId: text, ...patchAnnotationProperties },
        required: ["componentId", ...annotationRequired],
      },
    },
    regionAnnotations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: text,
          memberElementIds: strings,
          anchorElementId: { type: ["string", "null"] },
          ...patchAnnotationProperties,
        },
        required: ["name", "memberElementIds", "anchorElementId", ...annotationRequired],
      },
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["labels", "describes", "controls", "submits", "navigates_to", "groups"] },
          fromId: text,
          toId: text,
          evidenceBasis: {
            type: "string",
            enum: ["explicit_design_evidence", "component_metadata", "visual_inference", "semantic_inference"],
          },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        },
        required: ["kind", "fromId", "toId", "evidenceBasis", "confidence"],
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
          affectedIds: strings,
          requiresUserInput: { type: "boolean" },
        },
        required: ["code", "description", "affectedIds", "requiresUserInput"],
      },
    },
  },
  required: ["elementAnnotations", "componentAnnotations", "regionAnnotations", "relationships", "uncertainties"],
};
