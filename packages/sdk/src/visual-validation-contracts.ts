import { z } from "zod";
import { figmaSourceProvenanceSchema } from "./design-engineer-contracts";

const boundedText = (limit: number) => z.string().max(limit);

export const VISUAL_VALIDATION_SCHEMA_VERSION = "1" as const;

export const visualViewportV1Schema = z.object({
  id: z.string().min(1),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
}).strict();
export type VisualViewportV1 = z.infer<typeof visualViewportV1Schema>;

export const safePreviewCommandV1Schema = z.object({
  executable: z.enum(["npm", "bun", "pnpm", "yarn"]),
  args: z.array(z.string().min(1).max(256)).max(32),
  scriptName: z.string().min(1).max(64),
}).strict();
export type SafePreviewCommandV1 = z.infer<typeof safePreviewCommandV1Schema>;

export const previewConfigurationV1Schema = z.object({
  command: safePreviewCommandV1Schema.optional(),
  readinessPath: z.string().regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/).default("/"),
  host: z.literal("127.0.0.1").default("127.0.0.1"),
  startupTimeoutMs: z.number().int().positive().max(120_000).default(30_000),
  outputLimitBytes: z.number().int().positive().max(1_000_000).default(100_000),
}).strict();
export type PreviewConfigurationV1 = z.infer<typeof previewConfigurationV1Schema>;

export const captureConfigurationV1Schema = z.object({
  fullPage: z.boolean().default(false),
  waitForFontsMs: z.number().int().positive().max(30_000).default(5_000),
  screenshotTimeoutMs: z.number().int().positive().max(60_000).default(15_000),
  maxImageBytes: z.number().int().positive().max(25_000_000).default(10_000_000),
  maxImagePixels: z.number().int().positive().max(16_777_216).default(8_000_000),
}).strict();
export type CaptureConfigurationV1 = z.infer<typeof captureConfigurationV1Schema>;

export const visualValidationInputV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_VALIDATION_SCHEMA_VERSION),
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  project: z.object({
    id: z.string().min(1),
    rootIdentity: z.string().min(1),
    contextFingerprint: z.string().min(1),
  }).strict(),
  generatedImplementationArtifactId: z.string().min(1),
  designSpecificationArtifactId: z.string().min(1),
  figmaSourceSnapshotArtifactId: z.string().min(1),
  requestedFrames: z.array(z.string().min(1)).max(100),
  framework: z.string().min(1),
  preview: previewConfigurationV1Schema,
  viewports: z.array(visualViewportV1Schema).min(1).max(8),
  capture: captureConfigurationV1Schema,
  agentVersion: z.string().min(1),
  modelProfileId: z.string().min(1).optional(),
  comparisonTimeoutMs: z.number().int().positive().max(120_000).default(30_000),
  maxEvidenceBytes: z.number().int().positive().max(50_000_000).default(25_000_000),
}).strict();
export type VisualValidationInputV1 = z.infer<typeof visualValidationInputV1Schema>;

export const previewTargetV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_VALIDATION_SCHEMA_VERSION),
  packageManager: z.enum(["npm", "bun", "pnpm", "yarn"]),
  command: safePreviewCommandV1Schema,
  cwdIdentity: z.string().min(1),
  expectedHost: z.literal("127.0.0.1"),
  assignedPort: z.number().int().min(1024).max(65535),
  startupTimeoutMs: z.number().int().positive().max(120_000),
  readinessUrl: z.string().url(),
  environmentAllowList: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(32),
  shutdownPolicy: z.enum(["always", "on-completion"]),
}).strict();
export type PreviewTargetV1 = z.infer<typeof previewTargetV1Schema>;

export const screenshotEvidenceV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_VALIDATION_SCHEMA_VERSION),
  evidenceId: z.string().min(1),
  sourceType: z.enum(["reference", "implementation"]),
  frame: z.object({ id: z.string().min(1).optional(), name: z.string().min(1).optional() }).strict(),
  viewport: visualViewportV1Schema,
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), artifactId: z.string().min(1) }).strict(),
  capturedAt: z.string().datetime(),
  captureMethod: z.enum(["figma", "fake-mcp", "browser", "synthetic"]),
  warnings: z.array(boundedText(500)).max(32),
  authenticity: z.enum(["real-figma", "fake-mcp", "browser-rendered", "synthetic-fixture", "unavailable"]),
  sourceLabel: z.string().min(1).max(64).optional(),
  sourceArtifactId: z.string().min(1).optional(),
  sourceProvenance: figmaSourceProvenanceSchema.optional(),
  specification: z.object({
    selector: z.string().min(1).max(256),
    boundingRectangle: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict().optional(),
    styles: z.record(z.union([z.string().max(256), z.number().finite()])).optional(),
  }).strict().array().max(64).optional(),
}).strict();
export type ScreenshotEvidenceV1 = z.infer<typeof screenshotEvidenceV1Schema>;

export const visualFindingCategoryV1Schema = z.enum([
  "layout", "spacing", "size", "alignment", "typography", "color", "border", "radius", "shadow", "visibility", "content", "responsive", "overflow", "component-structure", "missing-element", "extra-element", "capture-error",
]);
export const visualFindingSeverityV1Schema = z.enum(["info", "minor", "major", "critical"]);
export const visualFindingStatusV1Schema = z.enum(["open", "confirmed", "not-applicable"]);
export const visualFindingV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_VALIDATION_SCHEMA_VERSION),
  findingId: z.string().min(1),
  category: visualFindingCategoryV1Schema,
  severity: visualFindingSeverityV1Schema,
  confidence: z.number().min(0).max(1),
  status: visualFindingStatusV1Schema,
  affectedFrame: z.string().min(1).optional(),
  affectedComponent: z.string().min(1).optional(),
  referenceEvidenceId: z.string().min(1).optional(),
  implementationEvidenceId: z.string().min(1).optional(),
  boundingRegion: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict().optional(),
  expectedValue: boundedText(2_000).optional(),
  actualValue: boundedText(2_000).optional(),
  measurableDelta: z.number().finite().optional(),
  explanation: boundedText(4_000),
  evidenceReferences: z.array(z.string().min(1)).max(32),
  origin: z.enum(["deterministic", "model-interpreted"]),
}).strict();
export type VisualFindingV1 = z.infer<typeof visualFindingV1Schema>;

export const viewportValidationResultV1Schema = z.object({
  viewport: visualViewportV1Schema,
  status: z.enum(["pass", "pass_with_findings", "fail", "inconclusive", "unavailable"]),
  implementationEvidenceIds: z.array(z.string().min(1)),
  referenceEvidenceIds: z.array(z.string().min(1)),
  findingIds: z.array(z.string().min(1)),
  metrics: z.object({
    pixelMismatchRatio: z.number().min(0).max(1).optional(),
    perceptualSimilarity: z.number().min(0).max(1).optional(),
    changedRegionCount: z.number().int().nonnegative().optional(),
    changedRegion: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict().optional(),
    dimensionCompatible: z.boolean(),
  }).strict(),
  warnings: z.array(boundedText(500)).max(32),
}).strict();
export type ViewportValidationResultV1 = z.infer<typeof viewportValidationResultV1Schema>;

export const visualValidationReportV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_VALIDATION_SCHEMA_VERSION),
  projectId: z.string().min(1),
  projectRootIdentity: z.string().min(1),
  generatedImplementationArtifactId: z.string().min(1),
  designSpecificationArtifactId: z.string().min(1),
  figmaSourceSnapshotArtifactId: z.string().min(1),
  referenceEvidence: z.array(screenshotEvidenceV1Schema),
  implementationEvidence: z.array(screenshotEvidenceV1Schema),
  viewportResults: z.array(viewportValidationResultV1Schema),
  findings: z.array(visualFindingV1Schema).max(500),
  summary: z.object({ byCategory: z.record(visualFindingCategoryV1Schema, z.number().int().nonnegative()), bySeverity: z.record(visualFindingSeverityV1Schema, z.number().int().nonnegative()) }).strict(),
  coverage: z.object({ requestedViewports: z.number().int().nonnegative(), capturedViewports: z.number().int().nonnegative(), referenceViewports: z.number().int().nonnegative(), requiredViewportCoverage: z.boolean() }).strict(),
  confidence: z.number().min(0).max(1),
  limitations: z.array(boundedText(1_000)).max(64),
  captureWarnings: z.array(boundedText(500)).max(64),
  comparisonMode: z.enum(["pixel-reference", "geometry-and-specification", "real-reference", "synthetic-fixture", "insufficient-reference"]),
  overallStatus: z.enum(["pass", "pass_with_findings", "fail", "inconclusive", "unavailable"]),
  passFailPolicy: z.object({ criticalFails: z.boolean(), majorDeterministicFails: z.boolean(), rendererFailureFails: z.boolean(), missingRequiredViewportFails: z.boolean(), unavailableReferenceIsInconclusive: z.boolean() }).strict(),
  agent: z.object({ id: z.literal("visual-validation-agent"), version: z.string().min(1), modelProfileId: z.string().min(1).optional() }).strict(),
  traceIds: z.array(z.string().min(1)),
}).strict();
export type VisualValidationReportV1 = z.infer<typeof visualValidationReportV1Schema>;

export const visualValidationAgentOutputV1Schema = z.object({
  findings: z.array(visualFindingV1Schema).max(500),
  interpretation: boundedText(4_000),
}).strict();
export type VisualValidationAgentOutputV1 = z.infer<typeof visualValidationAgentOutputV1Schema>;
