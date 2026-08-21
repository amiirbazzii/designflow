import { describe, expect, it } from "bun:test";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import {
  createFreshBuilderEvidence,
  FreshBuilderEvidenceIncompleteError,
} from "./fresh-builder-evidence";

function evidence(overrides: Record<string, unknown> = {}): FreshFrameEvidence {
  return {
    schemaVersion: "1",
    frame: { id: "1:1", name: "Full screen", path: ["Full screen"], width: 440, height: 1092 },
    snapshot: {
      source: { designFile: "Full screen", resolvedFrames: [{ id: "1:1", name: "Full screen", path: ["Full screen"] }] },
      nodes: [
        {
          id: "1:1", name: "Full screen", type: "FRAME", childIds: ["1:2", "1:3", "1:4"],
          absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 1092 },
          layoutMode: "VERTICAL", itemSpacing: 16, fills: [{ type: "SOLID", color: "#ffffff" }],
          strokes: [], effects: [], properties: {},
        },
        {
          id: "1:2", name: "Header", type: "TEXT", parentId: "1:1", childIds: [],
          absoluteBoundingBox: { x: 16, y: 16, width: 200, height: 24 },
          characters: "Add Transaction", fills: [{ type: "SOLID", color: "#111111" }],
          strokes: [], effects: [], properties: { typography: { fontFamily: "Poppins", fontSizePx: 20 } },
        },
        {
          id: "1:3", name: "Form", type: "FRAME", parentId: "1:1", childIds: [],
          absoluteBoundingBox: { x: 16, y: 80, width: 408, height: 400 },
          fills: [], strokes: [], effects: [], properties: {},
        },
        {
          id: "1:4", name: "Bottom navigation", type: "FRAME", parentId: "1:1", childIds: [],
          absoluteBoundingBox: { x: 0, y: 1020, width: 440, height: 72 }, componentId: "1:4",
          fills: [], strokes: [], effects: [], properties: {},
        },
      ],
      variables: [
        { name: "unused", value: "#fff" },
        { name: "used", value: "#111" },
      ],
      styles: [],
      components: [
        { id: "1:4", name: "Navigation menu" },
        { id: "unused-component", name: "Unused" },
      ],
      assets: [],
      screenshots: [{ nodeId: "1:1", artifactId: "reference", format: "png", width: 440, height: 1092 }],
      warnings: [],
      capabilities: {},
      provenance: { mcpServerIdentity: "figma-desktop-mcp", retrievedAt: "volatile" },
      sourceProvenance: {},
      ...overrides,
    },
    referenceScreenshot: { nodeId: "1:1", artifactId: "reference", format: "png", width: 440, height: 1092 },
    specificationEvidence: {
      elements: [{ nodeId: "1:1", name: "duplicated" }],
      instances: [{ nodeId: "1:4", contents: [{ nodeId: "child" }] }],
      foundations: { debug: "omit" },
    },
  } as unknown as FreshFrameEvidence;
}

describe("Fresh Builder evidence projection", () => {
  it("keeps one canonical hierarchy and removes raw/specification duplication", () => {
    const result = createFreshBuilderEvidence(evidence());
    expect(result.evidence.hierarchy.map((node) => node.name)).toEqual([
      "Full screen", "Header", "Form", "Bottom navigation",
    ]);
    expect(result.evidence.hierarchy[1]?.text).toBe("Add Transaction");
    expect(result.evidence.hierarchy[1]?.style?.typography).toEqual({ fontFamily: "Poppins", fontSizePx: 20 });
    expect(result.evidence).not.toHaveProperty("snapshot");
    expect(result.evidence).not.toHaveProperty("specificationEvidence");
    expect(result.evidence.components).toEqual([{ id: "1:4", name: "Navigation menu" }]);
    expect(result.evidence.referenceScreenshot?.artifactId).toBe("reference");
    expect(result.metrics.freshBuilderEvidenceBytes).toBeLessThan(result.metrics.authoritativeEvidenceBytes);
    expect(result.metrics.approximateBuilderInputTokens).toBeGreaterThan(0);
  });

  it("reports visible component instances whose descendants were not expanded", () => {
    const incomplete = evidence({ nodes: evidence().snapshot.nodes.map((node) => node.id === "1:4" ? { ...node, type: "INSTANCE" } : node) });
    expect(() => createFreshBuilderEvidence(incomplete)).toThrow(FreshBuilderEvidenceIncompleteError);
    try {
      createFreshBuilderEvidence(incomplete);
    } catch (error) {
      expect(error).toMatchObject({ code: "ERR_FRESH_UI_EVIDENCE_INCOMPLETE" });
      expect((error as FreshBuilderEvidenceIncompleteError).completeness).toMatchObject({
        complete: false,
        unresolvedVisibleInstances: [{ id: "1:4", name: "Bottom navigation", parentId: "1:1" }],
      });
    }
  });

  it("keeps only variables referenced by node bindings", () => {
    const source = evidence();
    const withBinding = {
      ...source,
      snapshot: {
        ...source.snapshot,
        nodes: source.snapshot.nodes.map((node) => node.id === "1:1" ? { ...node, boundVariables: { fill: "used" } } : node),
      },
    } as FreshFrameEvidence;
    expect(createFreshBuilderEvidence(withBinding).evidence.variables).toEqual([{ name: "used", value: "#111" }]);
    expect(createFreshBuilderEvidence(withBinding).evidence.hierarchy[0]?.boundVariables).toEqual({ fill: "used" });
  });

  it("scopes the projection to the selected frame and keeps referenced resources", () => {
    const source = evidence();
    const scoped = {
      ...source,
      snapshot: {
        ...source.snapshot,
        nodes: [
          ...source.snapshot.nodes.map((node) => node.id === "1:1"
            ? { ...node, properties: { styleId: "style-used", assetId: "asset-used" } }
            : node),
          { id: "other", name: "Other page", type: "FRAME", childIds: [], absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 }, fills: [], strokes: [], effects: [], properties: {} },
        ],
        styles: [{ id: "style-used", name: "Used", styleType: "FILL", value: { color: "#fff" } }, { id: "style-unused", name: "Unused", styleType: "FILL" }],
        assets: [{ id: "asset-used", name: "Used image", type: "IMAGE", reference: "asset-used" }, { id: "asset-unused", name: "Unused image", type: "IMAGE" }],
      },
    } as unknown as FreshFrameEvidence;
    const result = createFreshBuilderEvidence(scoped);
    expect(result.evidence.hierarchy.every((node) => node.id !== "other")).toBe(true);
    expect(result.evidence.styles.map((style) => style.id)).toEqual(["style-used"]);
    expect(result.evidence.assets.map((asset) => asset.id)).toEqual(["asset-used"]);
  });

  it("fails closed when detailed design context was not retrieved", () => {
    expect(() => createFreshBuilderEvidence(evidence({ warnings: [{ code: "DESIGN_CONTEXT_RETRIEVAL_FAILED", message: "timed out" }] })))
      .toThrow(FreshBuilderEvidenceIncompleteError);
    try {
      createFreshBuilderEvidence(evidence({ warnings: [{ code: "DESIGN_CONTEXT_RETRIEVAL_FAILED", message: "timed out" }] }));
    } catch (error) {
      expect(error).toMatchObject({ code: "ERR_FRESH_UI_EVIDENCE_INCOMPLETE" });
      expect((error as FreshBuilderEvidenceIncompleteError).completeness.blockingWarnings)
        .toEqual(["DESIGN_CONTEXT_RETRIEVAL_FAILED"]);
    }
  });

  it("fails closed when instance expansion is bounded", () => {
    expect(() => createFreshBuilderEvidence(evidence({
      warnings: [{ code: "INSTANCE_EXPANSION_BOUNDED", message: "descendants omitted" }],
    }))).toThrow(FreshBuilderEvidenceIncompleteError);
  });
});
