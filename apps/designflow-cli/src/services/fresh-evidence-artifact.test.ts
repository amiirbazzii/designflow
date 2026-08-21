import { describe, expect, it } from "bun:test";
import { InMemoryArtifactStore } from "@designflow/core";
import { figmaSourceSnapshotSchema } from "@designflow/sdk";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import {
  FreshEvidenceArtifactError,
  loadFreshAuthoritativeEvidence,
  persistFreshAuthoritativeEvidence,
} from "./fresh-evidence-artifact";

function evidence(overrides: Record<string, unknown> = {}): FreshFrameEvidence {
  const snapshot = figmaSourceSnapshotSchema.parse({
    source: {
      designFile: "https://www.figma.com/design/file/Screen?node-id=1-1",
      originalInput: "https://www.figma.com/design/file/Screen?node-id=1-1",
      fileKey: "file",
      nodeIds: ["1:1"],
      frames: [],
      resolvedFrames: [{ id: "1:1", name: "Screen", path: ["Screen"] }],
    },
    capabilities: { screenshotsAvailable: true },
    nodes: [
      {
        id: "1:1", name: "Screen", type: "FRAME", childIds: ["1:2"],
        absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 1092 },
        fills: [], strokes: [], effects: [], properties: {}, exportSettings: [], interactions: [],
      },
      {
        id: "1:2", name: "Header", type: "TEXT", parentId: "1:1", childIds: [],
        absoluteBoundingBox: { x: 16, y: 16, width: 200, height: 24 }, characters: "Add Transaction",
        fills: [], strokes: [], effects: [], properties: {}, exportSettings: [], interactions: [],
      },
    ],
    variables: [], styles: [], components: [], assets: [],
    screenshots: [{ nodeId: "1:1", artifactId: "reference-1", format: "png", width: 440, height: 1092 }],
    warnings: [],
    provenance: { mcpServerIdentity: "figma-desktop-mcp", retrievedAt: "volatile" },
    sourceProvenance: { mode: "mcp-desktop", transport: "http", serverIdentity: "figma-desktop", requestedFileKey: "file", requestedNodeId: "1:1", resolvedNodeId: "1:1" },
  });
  return {
    schemaVersion: "1",
    frame: { id: "1:1", name: "Screen", path: ["Screen"], width: 440, height: 1092 },
    snapshot,
    specificationEvidence: { hierarchy: ["Screen", "Header"] },
    referenceScreenshot: snapshot.screenshots[0],
    ...overrides,
  } as FreshFrameEvidence;
}

describe("Fresh authoritative evidence artifacts", () => {
  it("persists complete evidence and replays the exact frame without Figma", async () => {
    const store = new InMemoryArtifactStore();
    const source = evidence();
    const ref = await persistFreshAuthoritativeEvidence(store, source);
    const replay = await loadFreshAuthoritativeEvidence(store, ref.id, {
      nodeId: "1:1", fileKey: "file", frameName: "Screen", width: 440, height: 1092,
    });
    expect(replay).toEqual(source);
    expect(ref.metadata).toMatchObject({
      type: "fresh.authoritative-evidence",
      frameId: "1:1",
      completeness: "passed",
      unresolvedVisibleInstanceCount: 0,
    });
  });

  it("does not persist incomplete evidence", async () => {
    let saves = 0;
    const store = { save: async () => { saves += 1; return { id: "never" }; } } as never;
    await expect(persistFreshAuthoritativeEvidence(store, evidence({
      snapshot: {
        ...evidence().snapshot,
        nodes: evidence().snapshot.nodes.map((node) => node.id === "1:2" ? { ...node, type: "INSTANCE" } : node),
      },
    }))).rejects.toMatchObject({ code: "ERR_FRESH_UI_EVIDENCE_INCOMPLETE" });
    expect(saves).toBe(0);
  });

  it("rejects a replay requested for a different node", async () => {
    const store = new InMemoryArtifactStore();
    const ref = await persistFreshAuthoritativeEvidence(store, evidence());
    await expect(loadFreshAuthoritativeEvidence(store, ref.id, { nodeId: "9:9" }))
      .rejects.toBeInstanceOf(FreshEvidenceArtifactError);
    await expect(loadFreshAuthoritativeEvidence(store, ref.id, { nodeId: "1:1", fileKey: "other-file" }))
      .rejects.toBeInstanceOf(FreshEvidenceArtifactError);
  });
});
