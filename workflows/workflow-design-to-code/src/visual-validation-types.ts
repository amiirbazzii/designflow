import { z } from "zod";
import {
  captureConfigurationV1Schema,
  visualValidationInputV1Schema,
  visualValidationReportV1Schema,
  screenshotEvidenceV1Schema,
  visualFindingV1Schema,
  visualViewportV1Schema,
  previewTargetV1Schema,
} from "@designflow/sdk";

export const VISUAL_VALIDATION_ARTIFACT_IDS = {
  input: "visual-validation-input",
  preview: "preview-runtime-record",
  implementationEvidence: "implementation-screenshot-evidence",
  referenceEvidence: "reference-screenshot-evidence",
  domEvidence: "dom-and-computed-style-evidence",
  metrics: "image-comparison-metrics",
  agentOutput: "visual-validation-agent-output",
  report: "visual-validation-report",
  summary: "stage-5-summary",
} as const;

export const VISUAL_VALIDATION_ARTIFACT_TYPES = {
  input: "validation.visual-input",
  preview: "validation.preview-runtime",
  implementationEvidence: "validation.implementation-screenshots",
  referenceEvidence: "validation.reference-screenshots",
  domEvidence: "validation.dom-style-evidence",
  metrics: "validation.image-comparison-metrics",
  agentOutput: "validation.visual-agent-output",
  report: "validation.visual-report",
  summary: "design.stage-5-summary",
} as const;

export const visualValidationWorkflowInputSchema = z.object({
  enabled: z.literal(true),
  project: z.object({ id: z.string().min(1), name: z.string().min(1), rootPath: z.string().min(1) }).strict(),
  stateDirectory: z.string().min(1),
  designFile: z.string().min(1),
  frames: z.array(z.string().min(1)).default([]),
  captureScreenshots: z.boolean().default(true),
  viewports: z.array(visualViewportV1Schema).default([
    { id: "desktop", width: 1440, height: 1024 },
    { id: "tablet", width: 768, height: 1024 },
    { id: "mobile", width: 390, height: 844 },
  ]),
  readinessPath: z.string().default("/"),
  capture: captureConfigurationV1Schema.default({}),
  agentVersion: z.string().min(1).default("0.1.0"),
  modelProfileId: z.string().min(1).optional(),
}).strict();
export type VisualValidationWorkflowInput = z.infer<typeof visualValidationWorkflowInputSchema>;

export const previewRuntimeRecordSchema = z.object({
  schemaVersion: z.literal("1"),
  status: z.enum(["ready", "unavailable", "failed"]),
  target: previewTargetV1Schema.optional(),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), exitCode: z.number().int().optional(), stdout: z.string().max(100_000), stderr: z.string().max(100_000), warnings: z.array(z.string().max(500)).max(64),
}).strict();
export type PreviewRuntimeRecordV1 = z.infer<typeof previewRuntimeRecordSchema>;

const domViewportEvidenceSchema = z.object({ viewport: visualViewportV1Schema, evidence: z.record(z.unknown()) }).strict();
export const screenshotEvidenceCollectionSchema = z.object({ schemaVersion: z.literal("1"), evidence: z.array(screenshotEvidenceV1Schema), domEvidence: z.array(domViewportEvidenceSchema).default([]), warnings: z.array(z.string().max(500)).max(64) }).strict();
export const domEvidenceCollectionSchema = z.object({ schemaVersion: z.literal("1"), viewports: z.array(domViewportEvidenceSchema), warnings: z.array(z.string().max(500)).max(64) }).strict();
export const visualComparisonMetricsSchema = z.object({
  schemaVersion: z.literal("1"), mode: z.enum(["pixel-reference", "geometry-and-specification", "synthetic-fixture", "insufficient-reference"]),
  comparison: z.object({
    algorithmVersion: z.literal("png-rgba-pixel-diff-v1"),
    threshold: z.number().min(0).max(255),
    mismatchRatioThreshold: z.number().min(0).max(1),
    maxPixels: z.number().int().positive(),
    maxImageBytes: z.number().int().positive(),
  }).default({ algorithmVersion: "png-rgba-pixel-diff-v1", threshold: 8, mismatchRatioThreshold: 0.005, maxPixels: 8_000_000, maxImageBytes: 10_000_000 }),
  findings: z.array(visualFindingV1Schema).max(500),
  referenceEvidence: z.array(screenshotEvidenceV1Schema), implementationEvidence: z.array(screenshotEvidenceV1Schema),
  viewportResults: z.array(z.object({ viewport: visualViewportV1Schema, status: z.enum(["pass", "pass_with_findings", "fail", "inconclusive", "unavailable"]), implementationEvidenceIds: z.array(z.string()), referenceEvidenceIds: z.array(z.string()), findingIds: z.array(z.string()), metrics: z.object({ pixelMismatchRatio: z.number().min(0).max(1).optional(), perceptualSimilarity: z.number().min(0).max(1).optional(), changedRegionCount: z.number().int().nonnegative().optional(), changedRegion: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict().optional(), dimensionCompatible: z.boolean() }).strict(), warnings: z.array(z.string().max(500)) }).strict()),
  warnings: z.array(z.string().max(500)).max(64),
}).strict();
export type VisualComparisonMetricsV1 = z.infer<typeof visualComparisonMetricsSchema>;

export const visualValidationSummarySchema = z.object({ schemaVersion: z.literal("1"), projectId: z.string().min(1), reportArtifactId: z.string().min(1), overallStatus: z.enum(["pass", "pass_with_findings", "fail", "inconclusive", "unavailable"]), viewportCount: z.number().int().nonnegative(), critical: z.number().int().nonnegative(), major: z.number().int().nonnegative(), minor: z.number().int().nonnegative(), referenceMode: z.string().min(1), projectFilesChanged: z.literal(false), correctionsApplied: z.literal(false) }).strict();
export type VisualValidationSummaryV1 = z.infer<typeof visualValidationSummarySchema>;

export type VisualValidationInput = z.infer<typeof visualValidationInputV1Schema>;
export type VisualValidationReport = z.infer<typeof visualValidationReportV1Schema>;
