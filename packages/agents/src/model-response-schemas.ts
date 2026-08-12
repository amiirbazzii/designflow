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
// ── Specification V2 provider shapes ─────────────────────────────
// Strict-JSON providers require every property to be listed as required, so
// optional evidence is expressed as ["string","null"]; the agent strips
// nulls before the authoritative Zod parse.
const maybeText = { type: ["string", "null"] } as const;

const specTypographyShape = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: { family: maybeText, weight: maybeText, size: maybeText, lineHeight: maybeText, letterSpacing: maybeText, color: maybeText, align: maybeText },
  required: ["family", "weight", "size", "lineHeight", "letterSpacing", "color", "align"],
} as const;

const specLayoutShape = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: { direction: { type: ["string", "null"], enum: ["horizontal", "vertical", "none", null] }, gap: maybeText, padding: maybeText, align: maybeText, justify: maybeText, sizing: maybeText, position: maybeText },
  required: ["direction", "gap", "padding", "align", "justify", "sizing", "position"],
} as const;

/** Bounded element nesting: three levels of children is enough for anatomy regions. */
function specElementShape(depth: number): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      nodeId: maybeText,
      name: text,
      role: maybeText,
      text: maybeText,
      width: maybeText,
      height: maybeText,
      layout: specLayoutShape,
      background: maybeText,
      border: maybeText,
      radius: maybeText,
      opacity: { type: ["number", "null"], minimum: 0, maximum: 1 },
      typography: specTypographyShape,
      effects: strings,
      asset: maybeText,
      componentName: maybeText,
      states: strings,
      notes: strings,
      children: depth > 0 ? { type: "array", items: specElementShape(depth - 1) } : { type: "array", maxItems: 0 },
    },
    required: ["nodeId", "name", "role", "text", "width", "height", "layout", "background", "border", "radius", "opacity", "typography", "effects", "asset", "componentName", "states", "notes", "children"],
  };
}

const specRegionShape = {
  type: "object",
  additionalProperties: false,
  properties: { nodeId: maybeText, name: text, role: maybeText, elements: { type: "array", items: specElementShape(3) } },
  required: ["nodeId", "name", "role", "elements"],
} as const;

const evidenceSource = { type: "string", enum: ["observedInSelection", "declaredByFigmaComponentMetadata"] } as const;

const specComponentContractShape = {
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
    screen: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: { name: text, width: maybeText, height: maybeText, layoutModel: maybeText, background: maybeText, scrollBehavior: maybeText },
      required: ["name", "width", "height", "layoutModel", "background", "scrollBehavior"],
    },
    anatomy: { type: "array", items: specRegionShape },
    componentContracts: { type: "array", items: specComponentContractShape },
    foundations: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: { colors: foundationValues, typography: foundationValues, spacing: foundationValues, radii: foundationValues, borders: foundationValues, shadows: foundationValues, iconSizing: foundationValues },
      required: ["colors", "typography", "spacing", "radii", "borders", "shadows", "iconSizing"],
    },
    assetDetails: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: text, name: text, type: text, reference: maybeText, width: maybeText, height: maybeText, purpose: maybeText }, required: ["id", "name", "type", "reference", "width", "height", "purpose"] } },
    observedStates: strings,
    inferredBehavior: strings,
    responsiveEvidence: strings,
    sourceIdentity: { type: "object", additionalProperties: false, properties: { designFile: text }, required: ["designFile"] },
    screenshotArtifactIds: strings,
    frames: strings,
    hierarchy: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: text, name: text }, required: ["id", "name"] } },
    designTokens: { type: "object", additionalProperties: false, properties: { colors: strings, spacing: strings, typography: strings, radii: strings, borders: strings, shadows: strings, referencedVariableNames: strings }, required: ["colors", "spacing", "typography", "radii", "borders", "shadows", "referencedVariableNames"] },
    components: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: text, role: text, sourceNodeIds: strings, variants: strings, requiredAssets: strings, implementationNotes: strings }, required: ["name", "role", "sourceNodeIds", "variants", "requiredAssets", "implementationNotes"] } },
    layoutBehavior: strings,
    responsiveAssumptions: strings,
    assets: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: text, name: text }, required: ["id", "name"] } },
    content: strings,
    interactions: strings,
    states: strings,
    accessibilityNotes: strings,
    ambiguities: { type: "array", items: { type: "object", additionalProperties: false, properties: { code: text, description: text, affectedNodeIds: strings, requiresUserInput: { type: "boolean" } }, required: ["code", "description", "affectedNodeIds", "requiresUserInput"] } },
    agentVersion: text,
  },
  required: ["schemaVersion", "screen", "anatomy", "componentContracts", "foundations", "assetDetails", "observedStates", "inferredBehavior", "responsiveEvidence", "sourceIdentity", "screenshotArtifactIds", "frames", "hierarchy", "designTokens", "components", "layoutBehavior", "responsiveAssumptions", "assets", "content", "interactions", "states", "accessibilityNotes", "ambiguities", "agentVersion"],
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
