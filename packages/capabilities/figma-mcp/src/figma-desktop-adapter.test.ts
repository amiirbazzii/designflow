import { describe, expect, test } from "bun:test";
import type { ArtifactStore, CapabilityContext } from "@designflow/sdk";
import { buildFigmaDesktopSourceSnapshot } from "./figma-desktop-adapter";
import { parseFigmaSource } from "./parse-figma-source";
import { InMemoryMcpClient } from "../test/support/in-memory-mcp-client";

function store(): ArtifactStore {
  const payloads = new Map<string, unknown>();
  return {
    async save(data: unknown) {
      const id = `desktop-payload-${payloads.size}`;
      payloads.set(id, data);
      return { id, data };
    },
    async get(id: string) {
      const data = payloads.get(id);
      return data === undefined ? null : { id, data };
    },
    async exists(id: string) { return payloads.has(id); },
  };
}

function context(mcp: CapabilityContext["mcp"]): CapabilityContext {
  return {
    executionId: "desktop-exec",
    workflowId: "desktop-workflow",
    capabilityId: "retrieve-figma-source-snapshot",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    artifactRefs: [],
    parentArtifacts: [],
    artifactStore: store(),
    config: {},
    signal: new AbortController().signal,
    mcp,
  };
}

const tools = [
  { name: "get_metadata" },
  { name: "get_design_context" },
  { name: "get_variable_defs" },
  { name: "get_screenshot" },
];

describe("Figma Desktop MCP adapter", () => {
  test("normalizes current selection metadata and image content without changing generic wrapper inputs", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "figma-desktop-mcp",
      tools,
      results: {
        get_metadata: [
          { type: "text", text: "Currently selected nodes:\n- 32148:21075: Header" },
          { type: "text", text: '<instance id="32148:21075" name="Header" x="0" y="0" width="440" height="64">' },
        ],
        get_design_context: [{ type: "text", text: "Detailed design context" }],
        get_variable_defs: [{ type: "text", text: "No variables selected" }],
        get_screenshot: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
      },
    });

    const snapshot = await buildFigmaDesktopSourceSnapshot(context(client), {
      parsedSource: parseFigmaSource("https://www.figma.com/design/abc123/Header", { frames: ["Header"] }),
      captureScreenshots: true,
      screenshotArtifactIdPrefix: "desktop-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    });

    expect(snapshot.nodes[0]).toMatchObject({ id: "32148:21075", name: "Header", type: "INSTANCE" });
    expect(snapshot.source.resolvedFrames).toEqual([{ id: "32148:21075", name: "Header", path: ["Header"] }]);
    expect(snapshot.screenshots).toHaveLength(1);
    expect(snapshot.screenshots[0]?.format).toBe("png");
    expect(snapshot.sourceProvenance).toEqual({
      mode: "mcp-desktop",
      transport: "http",
      serverIdentity: "figma-desktop",
      requestedFileKey: "abc123",
      resolvedNodeId: "32148:21075",
    });
    expect(snapshot.capabilities.stylesAvailable).toBe(false);
    expect(snapshot.warnings.map((warning) => warning.code)).toEqual([
      "DESKTOP_MCP_SELECTION_SCOPE",
      "VARIABLES_SHAPE_UNRECOGNIZED",
    ]);
    expect(client.calls.map((call) => call.toolName)).toEqual([
      "get_metadata",
      "get_design_context",
      "get_variable_defs",
      "get_screenshot",
    ]);
    expect(client.calls[0]?.arguments).toEqual({});
    expect(client.calls[1]?.arguments).toEqual({
      nodeId: "32148:21075",
      clientLanguages: "typescript",
      clientFrameworks: "react",
    });
    expect(client.calls[2]?.arguments).toEqual(client.calls[1]?.arguments);
    expect(client.calls[3]?.arguments).toEqual({ nodeId: "32148:21075", contentsOnly: true });
    expect(client.calls.every((call) => !("fileKey" in call.arguments))).toBe(true);
  });

  test("preserves the full outline hierarchy and enriches nodes with design-context facts", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "figma-desktop-mcp",
      tools,
      results: {
        get_metadata: [
          { type: "text", text: "Currently selected nodes:\n- 10:1: Screen A" },
          {
            type: "text",
            text: [
              '<frame id="10:1" name="Screen A" x="0" y="0" width="440" height="1092">',
              '  <frame id="10:2" name="Header" x="0" y="0" width="440" height="64">',
              '    <text id="10:4" name="Title" x="56" y="17" width="171" height="30" />',
              '  </frame>',
              '  <instance id="10:8" name="Nav" x="0" y="1020" width="440" height="72" />',
              '</frame>',
            ].join("\n"),
          },
        ],
        get_design_context: [
          {
            type: "text",
            text: [
              '<div className="bg-white relative" data-node-id="10:1">',
              '  <div className="bg-[#f9f9f9] flex gap-[8px] rounded-[16px]" data-node-id="10:2">',
              "    <p className=\"font-['Poppins:Bold'] text-[20px] text-black\" data-node-id=\"10:4\">Add Transaction</p>",
              "  </div>",
              "</div>",
            ].join("\n"),
          },
        ],
        get_variable_defs: [
          { type: "text", text: '{"Font":"Poppins","Stroke/Neutral/stroke":"#00000005","spacingNone":"0"}' },
        ],
        get_screenshot: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }],
      },
    });

    const snapshot = await buildFigmaDesktopSourceSnapshot(context(client), {
      parsedSource: parseFigmaSource("https://www.figma.com/design/abc123/ScreenA?node-id=10-1"),
      captureScreenshots: true,
      screenshotArtifactIdPrefix: "desktop-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    });

    // Hierarchy: all outline nodes survive with parent/child links and geometry.
    expect(snapshot.nodes.map((node) => node.id)).toEqual(["10:1", "10:2", "10:4", "10:8"]);
    expect(snapshot.nodes[0]?.childIds).toEqual(["10:2", "10:8"]);
    expect(snapshot.nodes.find((node) => node.id === "10:4")).toMatchObject({
      parentId: "10:2",
      type: "TEXT",
      absoluteBoundingBox: { x: 56, y: 17, width: 171, height: 30 },
    });

    // Design-context enrichment: text, fills, radius, gap, layout, typography.
    const header = snapshot.nodes.find((node) => node.id === "10:2")!;
    expect(header.fills).toEqual([{ type: "SOLID", color: "#f9f9f9" }]);
    expect(header.cornerRadius).toBe(16);
    expect(header.itemSpacing).toBe(8);
    expect(header.layoutMode).toBe("HORIZONTAL");

    const title = snapshot.nodes.find((node) => node.id === "10:4")!;
    expect(title.characters).toBe("Add Transaction");
    expect(title.fills).toEqual([{ type: "SOLID", color: "black" }]);
    expect(title.properties.typography).toEqual({ fontFamily: "Poppins", fontStyle: "Bold", fontSize: 20 });

    // Variables: the real JSON-in-text shape is parsed, colors typed.
    expect(snapshot.variables).toEqual([
      { name: "Font", value: "Poppins" },
      { name: "Stroke/Neutral/stroke", value: "#00000005", type: "COLOR" },
      { name: "spacingNone", value: "0" },
    ]);
    expect(snapshot.warnings.map((warning) => warning.code)).not.toContain("VARIABLES_SHAPE_UNRECOGNIZED");

    // Components: instance nodes are recorded as real component references.
    expect(snapshot.components).toEqual([{ id: "10:8", name: "Nav" }]);
    expect(snapshot.capabilities.componentsAvailable).toBe(true);
  });

  test("sparse design context does not erase metadata-derived evidence", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "figma-desktop-mcp",
      tools: [{ name: "get_metadata" }, { name: "get_design_context" }],
      results: {
        get_metadata: [
          { type: "text", text: "- 10:1: Screen A" },
          {
            type: "text",
            text: '<frame id="10:1" name="Screen A" x="0" y="0" width="440" height="100"><text id="10:2" name="T" x="0" y="0" width="50" height="20" /></frame>',
          },
        ],
        get_design_context: [{ type: "text", text: "no recognizable markup at all" }],
      },
    });

    const snapshot = await buildFigmaDesktopSourceSnapshot(context(client), {
      parsedSource: parseFigmaSource("https://www.figma.com/design/abc123/ScreenA?node-id=10-1"),
      captureScreenshots: false,
      screenshotArtifactIdPrefix: "desktop-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    });

    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0]?.childIds).toEqual(["10:2"]);
    expect(snapshot.nodes[0]?.absoluteBoundingBox).toEqual({ x: 0, y: 0, width: 440, height: 100 });
  });

  test("fails honestly when no evidence beyond node identity is retrievable", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "figma-desktop-mcp",
      tools: [{ name: "get_metadata" }],
      results: {
        get_metadata: [{ type: "text", text: "- 10:1: Screen A" }],
      },
    });

    await expect(buildFigmaDesktopSourceSnapshot(context(client), {
      parsedSource: parseFigmaSource("https://www.figma.com/design/abc123/ScreenA?node-id=10-1"),
      captureScreenshots: false,
      screenshotArtifactIdPrefix: "desktop-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "ERR_FIGMA_EVIDENCE_INSUFFICIENT" });
  });

  test("does not claim a requested node when Desktop MCP returns another selection", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "figma-desktop-mcp",
      tools: [{ name: "get_metadata" }],
      results: { get_metadata: [{ type: "text", text: "- 1:2: Other" }] },
    });

    await expect(buildFigmaDesktopSourceSnapshot(context(client), {
      parsedSource: parseFigmaSource("https://www.figma.com/design/abc123/Header?node-id=3-4"),
      captureScreenshots: false,
      screenshotArtifactIdPrefix: "desktop-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "ERR_FIGMA_NODE_NOT_FOUND" });
  });

  test("stops before implementation when the selected node name does not match the requested frame", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "figma-desktop-mcp",
      tools: [{ name: "get_metadata" }],
      results: { get_metadata: [{ type: "text", text: "- 1026:6098: iPhone 16 Pro Max - 14" }] },
    });

    await expect(buildFigmaDesktopSourceSnapshot(context(client), {
      parsedSource: parseFigmaSource("https://www.figma.com/design/abc123/Spendly?node-id=1026-6098", { frames: ["Header"] }),
      captureScreenshots: false,
      screenshotArtifactIdPrefix: "desktop-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    })).rejects.toMatchObject({
      code: "ERR_FIGMA_FRAME_SEMANTIC_MISMATCH",
      message: expect.stringContaining("Header"),
      metadata: expect.objectContaining({ resolvedName: "iPhone 16 Pro Max - 14", resolvedNodeId: "1026:6098" }),
    });
    expect(client.calls.map((call) => call.toolName)).toEqual(["get_metadata"]);
  });
});
