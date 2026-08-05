import { describe, expect, test } from "bun:test";
import type { ArtifactStore, CapabilityContext } from "@designflow/sdk";
import { buildFigmaDesktopSourceSnapshot } from "./figma-desktop-adapter";
import { parseFigmaSource } from "./parse-figma-source";
import { InMemoryMcpClient } from "./in-memory-mcp-client.test-support";

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
          { type: "text", text: '<instance id="32148:21075" name="Header">' },
        ],
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
    expect(snapshot.capabilities.stylesAvailable).toBe(false);
    expect(snapshot.warnings.map((warning) => warning.code)).toEqual([
      "DESKTOP_MCP_SELECTION_SCOPE",
      "VARIABLES_SHAPE_UNRECOGNIZED",
    ]);
    expect(client.calls.map((call) => call.toolName)).toEqual([
      "get_metadata",
      "get_variable_defs",
      "get_screenshot",
    ]);
    expect(client.calls.every((call) => !("fileKey" in call.arguments))).toBe(true);
    expect(client.calls.every((call) => Object.keys(call.arguments).length === 0)).toBe(true);
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
});
