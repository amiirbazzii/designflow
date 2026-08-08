import { describe, expect, test } from "bun:test";
import {
  figmaSourceSnapshotSchema,
  visualValidationReportV1Schema,
} from "@designflow/sdk";
import { hasTrustedPersistedReference } from "./feedback-loop-revalidation";

const hash = "a".repeat(64);

function referenceReport() {
  return visualValidationReportV1Schema.parse({
    schemaVersion: "1",
    projectId: "project",
    projectRootIdentity: hash,
    generatedImplementationArtifactId: "generated",
    designSpecificationArtifactId: "specification",
    figmaSourceSnapshotArtifactId: "figma-source-snapshot",
    referenceEvidence: [{
      schemaVersion: "1",
      evidenceId: "reference-frame-desktop",
      sourceType: "reference",
      frame: { id: "1026:6098", name: "Spendly" },
      viewport: { id: "desktop", width: 440, height: 1092 },
      image: { width: 440, height: 1092, contentHash: hash, artifactId: "reference-png" },
      capturedAt: "2026-08-08T00:00:00.000Z",
      captureMethod: "figma",
      warnings: [],
      authenticity: "real-figma",
      sourceArtifactId: "reference-png",
      sourceProvenance: { mode: "mcp-desktop", transport: "http", serverIdentity: "figma-desktop", requestedFileKey: "file-key", requestedNodeId: "1026:6098", resolvedNodeId: "1026:6098" },
    }],
    implementationEvidence: [],
    viewportResults: [],
    findings: [],
    summary: { byCategory: {}, bySeverity: {} },
    coverage: { requestedViewports: 1, capturedViewports: 0, referenceViewports: 1, requiredViewportCoverage: false },
    confidence: 1,
    limitations: [],
    captureWarnings: [],
    comparisonMode: "real-reference",
    overallStatus: "fail",
    passFailPolicy: { criticalFails: true, majorDeterministicFails: true, rendererFailureFails: true, missingRequiredViewportFails: true, unavailableReferenceIsInconclusive: true },
    agent: { id: "visual-validation-agent", version: "1" },
    traceIds: [],
  });
}

function referenceSnapshot() {
  return figmaSourceSnapshotSchema.parse({
    schemaVersion: "1",
    source: { designFile: "Spendly", fileKey: "file-key", nodeIds: ["1026:6098"], frames: ["Spendly"] },
    capabilities: { screenshotsAvailable: true },
    nodes: [],
    screenshots: [{ nodeId: "1026:6098", artifactId: "reference-png", width: 440, height: 1092, format: "png" }],
    warnings: [],
    sourceProvenance: { mode: "mcp-desktop", transport: "http", serverIdentity: "figma-desktop", requestedFileKey: "file-key", requestedNodeId: "1026:6098", resolvedNodeId: "1026:6098" },
  });
}

describe("correction reference reuse", () => {
  test("reuses a persisted reference only for the same file, node, and artifact", () => {
    expect(hasTrustedPersistedReference(referenceSnapshot(), referenceReport())).toBe(true);
    const differentFile = figmaSourceSnapshotSchema.parse({ ...referenceSnapshot(), source: { ...referenceSnapshot().source, fileKey: "other-file" } });
    expect(hasTrustedPersistedReference(differentFile, referenceReport())).toBe(false);
    const differentNode = figmaSourceSnapshotSchema.parse({ ...referenceSnapshot(), source: { ...referenceSnapshot().source, nodeIds: ["other-node"] } });
    expect(hasTrustedPersistedReference(differentNode, referenceReport())).toBe(false);
  });

  test("does not treat a missing persisted reference as reusable", () => {
    expect(hasTrustedPersistedReference(undefined, referenceReport())).toBe(false);
  });
});
