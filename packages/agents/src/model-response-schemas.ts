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
export const figmaSpecificationResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["2"] },
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
  required: ["schemaVersion", "sourceIdentity", "screenshotArtifactIds", "frames", "hierarchy", "designTokens", "components", "layoutBehavior", "responsiveAssumptions", "assets", "content", "interactions", "states", "accessibilityNotes", "ambiguities", "agentVersion"],
};

export const implementationResponseSchema: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    files: { type: "array", items: { type: "object", additionalProperties: false, properties: { path: text, action: { type: "string", enum: ["create", "modify"] }, content: text, reason: text }, required: ["path", "action", "content", "reason"] } },
    assumptions: strings,
    unresolvedItems: strings,
    implementationVersion: text,
  },
  required: ["files", "assumptions", "unresolvedItems", "implementationVersion"],
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
