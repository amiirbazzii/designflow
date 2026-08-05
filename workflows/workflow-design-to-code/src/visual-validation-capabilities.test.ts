import { describe, expect, test } from "bun:test";
import { figmaSourceSnapshotSchema, screenshotEvidenceV1Schema } from "@designflow/sdk";
import {
  associateReferenceViewport,
  classifyReferenceSource,
  comparisonModeForReferenceEvidence,
  referencesForViewport,
} from "./visual-validation-capabilities";

const pngHash = "a".repeat(64);

function evidence(overrides: Record<string, unknown> = {}) {
  return screenshotEvidenceV1Schema.parse({
    schemaVersion: "1",
    evidenceId: "reference-1-mobile",
    sourceType: "reference",
    frame: { id: "1:2", name: "Header" },
    viewport: { id: "mobile", width: 390, height: 844 },
    image: { width: 390, height: 844, contentHash: pngHash, artifactId: "real-png" },
    capturedAt: new Date(0).toISOString(),
    captureMethod: "figma",
    warnings: [],
    authenticity: "real-figma",
    ...overrides,
  });
}

describe("Stage 5 real-reference evidence", () => {
  test("preserves Desktop MCP provenance and the source screenshot artifact", () => {
    const snapshot = figmaSourceSnapshotSchema.parse({
      source: { designFile: "figma://file", nodeIds: ["1:2"], frames: ["Header"], resolvedFrames: [] },
      sourceProvenance: {
        mode: "mcp-desktop",
        transport: "http",
        serverIdentity: "figma-desktop",
        requestedFileKey: "file",
        requestedNodeId: "1:2",
        resolvedNodeId: "1:2",
      },
      screenshots: [{ nodeId: "1:2", artifactId: "real-png", width: 413, height: 1024, format: "png" }],
    });

    expect(classifyReferenceSource(snapshot)).toEqual({ captureMethod: "figma", authenticity: "real-figma", sourceLabel: "figma-desktop" });
    const ref = evidence({ sourceArtifactId: "real-png", sourceProvenance: snapshot.sourceProvenance });
    expect(ref.sourceArtifactId).toBe("real-png");
    expect(ref.sourceProvenance?.mode).toBe("mcp-desktop");
    expect(comparisonModeForReferenceEvidence([ref])).toBe("real-reference");
  });

  test("keeps REST real and synthetic sources distinct", () => {
    const rest = figmaSourceSnapshotSchema.parse({
      source: { designFile: "figma://file", nodeIds: [], frames: [], resolvedFrames: [] },
      sourceProvenance: { mode: "rest", transport: "rest", serverIdentity: "figma-rest", requestedFileKey: "file" },
    });
    const synthetic = figmaSourceSnapshotSchema.parse({
      source: { designFile: "fixture", nodeIds: [], frames: [], resolvedFrames: [] },
      sourceProvenance: { mode: "mcp-stdio", transport: "stdio", serverIdentity: "fake-mcp", requestedFileKey: "fixture" },
    });

    expect(classifyReferenceSource(rest).sourceLabel).toBe("figma-rest");
    expect(classifyReferenceSource(rest).authenticity).toBe("real-figma");
    expect(classifyReferenceSource(synthetic)).toEqual({ captureMethod: "fake-mcp", authenticity: "synthetic-fixture", sourceLabel: "synthetic-fixture" });
    expect(comparisonModeForReferenceEvidence([evidence({ authenticity: "synthetic-fixture", captureMethod: "fake-mcp", sourceLabel: "synthetic-fixture" })])).toBe("synthetic-fixture");
  });

  test("does not guess the authenticity of a snapshot without typed provenance", () => {
    expect(classifyReferenceSource({})).toEqual({ captureMethod: "synthetic", authenticity: "unavailable", sourceLabel: "unavailable" });
    expect(comparisonModeForReferenceEvidence([evidence({ authenticity: "unavailable", captureMethod: "synthetic", sourceLabel: "unavailable" })])).toBe("insufficient-reference");
  });

  test("classifies a 413x1024 native frame as mobile rather than desktop", () => {
    const viewport = associateReferenceViewport(413, 1024, [
      { id: "desktop", width: 1440, height: 1024 },
      { id: "tablet", width: 768, height: 1024 },
      { id: "mobile", width: 390, height: 844 },
    ]);
    expect(viewport).toEqual({ id: "mobile", width: 413, height: 1024 });
  });

  test("uses source-native when dimensions do not support a stable viewport match", () => {
    expect(associateReferenceViewport(500, 500, [
      { id: "desktop", width: 1440, height: 1024 },
      { id: "tablet", width: 768, height: 1024 },
      { id: "mobile", width: 390, height: 844 },
    ])).toEqual({ id: "source-native", width: 500, height: 500 });
  });

  test("does not turn a real reference into synthetic mode when implementation capture is unavailable", () => {
    expect(comparisonModeForReferenceEvidence([evidence()])).toBe("real-reference");
  });

  test("does not reuse one source-native reference for unrelated viewports", () => {
    const reference = evidence({ viewport: { id: "mobile", width: 413, height: 1024 } });
    expect(referencesForViewport([reference], "mobile")).toHaveLength(1);
    expect(referencesForViewport([reference], "desktop")).toHaveLength(0);
    expect(referencesForViewport([reference], "tablet")).toHaveLength(0);
  });
});
