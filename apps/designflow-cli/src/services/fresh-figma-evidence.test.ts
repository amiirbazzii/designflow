import { describe, expect, it } from "bun:test";
import { DesignFlowError, figmaSourceSnapshotSchema } from "@designflow/sdk";
import { designFromUrl } from "./figma-selection";
import {
  FreshEvidenceInvalidError,
  normalizeFreshFrameEvidence,
  retrieveFreshFrameEvidence,
} from "./fresh-figma-evidence";
import { readyFreshUiState } from "../ui/tui/fresh-ui";

function snapshot(overrides: Record<string, unknown> = {}) {
  return figmaSourceSnapshotSchema.parse({
    source: {
      designFile: "https://www.figma.com/design/file-key/Checkout?node-id=10-20",
      originalInput: "https://www.figma.com/design/file-key/Checkout?node-id=10-20",
      normalizedUrl: "https://www.figma.com/design/file-key?node-id=10-20",
      fileKey: "file-key",
      nodeIds: ["10:20"],
      frames: [],
      resolvedFrames: [{ id: "10:20", name: "Checkout", path: ["Checkout"] }],
      documentName: "Checkout",
      documentVersion: "7",
    },
    capabilities: {
      variablesAvailable: true,
      stylesAvailable: false,
      componentsAvailable: false,
      assetsAvailable: true,
      screenshotsAvailable: true,
    },
    nodes: [
      {
        id: "10:20",
        name: "Checkout",
        type: "FRAME",
        childIds: ["10:21"],
        absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
        fills: [{ type: "SOLID", color: "#ffffff" }],
        strokes: [],
        effects: [],
        cornerRadius: 16,
        layoutMode: "VERTICAL",
        itemSpacing: 24,
        padding: { top: 24, right: 20, bottom: 24, left: 20 },
        properties: {},
        exportSettings: [],
        interactions: [],
      },
      {
        id: "10:21",
        name: "Heading",
        type: "TEXT",
        parentId: "10:20",
        childIds: [],
        absoluteBoundingBox: { x: 20, y: 24, width: 200, height: 32 },
        characters: "Checkout",
        fills: [{ type: "SOLID", color: "#111827" }],
        strokes: [],
        effects: [],
        properties: { typography: { fontFamily: "Inter", fontStyle: "Bold", fontSize: 24 } },
        exportSettings: [],
        interactions: [],
      },
    ],
    variables: [],
    styles: [],
    components: [],
    assets: [{ id: "asset-1", name: "Logo", type: "SVG", reference: "asset://logo.svg", format: "svg" }],
    screenshots: [{ nodeId: "10:20", artifactId: "screenshot-1", format: "png", width: 390, height: 844 }],
    warnings: [{ code: "DESKTOP_MCP_SELECTION_SCOPE", message: "Selection scope is bounded.", nodeId: "10:20" }],
    provenance: {
      mcpServerIdentity: "figma-desktop-mcp",
      retrievedAt: "2026-08-20T00:00:00.000Z",
      toolVersions: { inspectDocument: "get_metadata" },
    },
    sourceProvenance: {
      mode: "mcp-desktop",
      transport: "http",
      serverIdentity: "figma-desktop",
      requestedFileKey: "file-key",
      requestedNodeId: "10:20",
      resolvedNodeId: "10:20",
    },
    ...overrides,
  });
}

function compileEvidence(value: ReturnType<typeof snapshot>) {
  return {
    foundations: { spacing: ["24px"] },
    elements: value.nodes
      .filter((node) => node.characters !== undefined)
      .map((node) => ({ text: node.characters })),
  };
}

describe("Fresh Figma frame evidence", () => {
  it("keeps the authoritative snapshot and exposes the trusted frame dimensions", () => {
    const result = normalizeFreshFrameEvidence(snapshot(), "10:20", compileEvidence);

    expect(result.frame).toEqual({
      id: "10:20",
      name: "Checkout",
      path: ["Checkout"],
      width: 390,
      height: 844,
    });
    expect(result.snapshot.nodes).toHaveLength(2);
    expect(result.snapshot.nodes[1]?.characters).toBe("Checkout");
    expect(result.snapshot.assets[0]?.reference).toBe("asset://logo.svg");
    expect(result.referenceScreenshot?.artifactId).toBe("screenshot-1");
    expect(result.specificationEvidence.foundations.spacing).toContain("24px");
    expect(result.specificationEvidence.elements.some((element) => element.text === "Checkout")).toBe(true);
    expect(result.snapshot.sourceProvenance?.serverIdentity).toBe("figma-desktop");
    expect(result.snapshot.warnings[0]?.code).toBe("DESKTOP_MCP_SELECTION_SCOPE");
  });

  it("rejects missing authoritative frame dimensions", () => {
    const incomplete = snapshot({
      nodes: [{
        id: "10:20",
        name: "Checkout",
        type: "FRAME",
        childIds: [],
        fills: [],
        strokes: [],
        effects: [],
        properties: {},
        exportSettings: [],
        interactions: [],
      }],
    });

    expect(() => normalizeFreshFrameEvidence(incomplete, "10:20", compileEvidence))
      .toThrow(FreshEvidenceInvalidError);
    expect(() => normalizeFreshFrameEvidence(incomplete, "10:20", compileEvidence))
      .toThrow("authoritative width and height");
  });

  it("retrieves through the host seam without a workflow or session", async () => {
    const state = readyFreshUiState(designFromUrl(
      "https://www.figma.com/design/file-key/Checkout?node-id=10-20",
    ));
    const calls: Array<{ sourceKind: string; nodeId: string }> = [];

    const result = await retrieveFreshFrameEvidence({
      source: state.source,
      nodeId: state.nodeId,
      sourceKind: "figma-url",
    }, async (source, sourceKind) => {
      calls.push({ sourceKind, nodeId: source.nodeIds[0] ?? "" });
      return snapshot();
    }, compileEvidence);

    expect(result.frame.id).toBe("10:20");
    expect(calls).toEqual([{ sourceKind: "figma-url", nodeId: "10:20" }]);
  });

  it("rejects missing, ambiguous, and mismatched frame resolution", () => {
    for (const resolvedFrames of [[], [
      { id: "10:20", name: "Checkout", path: ["Checkout"] },
      { id: "10:21", name: "Other", path: ["Other"] },
    ]]) {
      expect(() => normalizeFreshFrameEvidence(snapshot({
        source: { ...snapshot().source, resolvedFrames },
      }), "10:20", compileEvidence)).toThrow(FreshEvidenceInvalidError);
    }
    expect(() => normalizeFreshFrameEvidence(snapshot(), "99:99", compileEvidence))
      .toThrow("did not resolve the requested Figma frame");
  });

  it("preserves typed host failures and does not require forbidden runtime collaborators", async () => {
    const state = readyFreshUiState(designFromUrl(
      "https://www.figma.com/design/file-key/Checkout?node-id=10-20",
    ));
    const forbiddenPathCalls: string[] = [];
    await expect(retrieveFreshFrameEvidence({
      source: state.source,
      nodeId: state.nodeId,
      sourceKind: "figma-url",
    }, async () => {
      expect(forbiddenPathCalls).toEqual([]);
      throw new DesignFlowError("ERR_FIGMA_MCP_UNAVAILABLE", "Figma Desktop is unavailable.");
    }, compileEvidence)).rejects.toMatchObject({ code: "ERR_FIGMA_MCP_UNAVAILABLE" });
    expect(forbiddenPathCalls).toEqual([]);
  });

  it("is stable for the same source apart from intentionally volatile retrieval time", () => {
    const first = normalizeFreshFrameEvidence(snapshot({
      provenance: { mcpServerIdentity: "figma-desktop-mcp", retrievedAt: "first" },
    }), "10:20", compileEvidence);
    const second = normalizeFreshFrameEvidence(snapshot({
      provenance: { mcpServerIdentity: "figma-desktop-mcp", retrievedAt: "second" },
    }), "10:20", compileEvidence);

    expect({ ...first, snapshot: { ...first.snapshot, provenance: { mcpServerIdentity: "figma-desktop-mcp" } } })
      .toEqual({ ...second, snapshot: { ...second.snapshot, provenance: { mcpServerIdentity: "figma-desktop-mcp" } } });
  });
});
