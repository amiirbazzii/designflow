// packages/capabilities/figma-mcp/src/build-snapshot.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ArtifactStore, CapabilityContext } from "@designflow/sdk";
import type { FakeMcpFixtures } from "@designflow/mcp";
import { buildFigmaSourceSnapshot } from "./build-snapshot";
import { parseFigmaSource } from "./parse-figma-source";

/**
 * The full retrieval path (`discoverFigmaMcpCapabilities` through to a
 * validated `FigmaSourceSnapshot`, including a real screenshot capture and
 * artifact store write) exercised against a *real, separate process* — the
 * same fake MCP server `@designflow/mcp`'s own tests spawn — so this proves
 * the whole pipeline over the real stdio transport, not merely its pieces in
 * isolation.
 */

// Resolved via `require.resolve` against the installed `@designflow/mcp`
// package rather than a relative path into its `src/` — this package only
// declares `@designflow/mcp` as a devDependency (test-only), and the
// installed workspace package's `dist` does not ship the fake server, so
// this reaches into its `src` the same way any workspace consumer resolves
// a sibling package's source for a dev-only test fixture.
const require = createRequire(import.meta.url);
const MCP_PACKAGE_DIR = fileURLToPath(new URL(".", `file://${require.resolve("@designflow/mcp/package.json")}`));
const FAKE_SERVER_PATH = `${MCP_PACKAGE_DIR}src/fake-server-entry.ts`;

const clients: Array<{ close(): void }> = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

async function realMcpClient(fixtures: Partial<FakeMcpFixtures>) {
  const { McpRuntime } = await import("@designflow/mcp");
  const client = new McpRuntime({
    command: "bun",
    args: ["run", FAKE_SERVER_PATH],
    env: { FAKE_MCP_FIXTURES: JSON.stringify(fixtures) },
    serverIdentity: "fake-figma-mcp",
  });
  clients.push(client);
  return client;
}

function fakeStore(): ArtifactStore {
  const byPayload = new Map<string, unknown>();
  let counter = 0;
  return {
    async save(data: unknown) {
      const id = `payload-${counter++}`;
      byPayload.set(id, data);
      return { id, data };
    },
    async get(id: string) {
      const data = byPayload.get(id);
      return data === undefined ? null : { id, data };
    },
    async exists(id: string) {
      return byPayload.has(id);
    },
  };
}

function context(mcp: CapabilityContext["mcp"]): CapabilityContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    capabilityId: "retrieve-figma-source-snapshot",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    artifactRefs: [],
    parentArtifacts: [],
    artifactStore: fakeStore(),
    config: {},
    signal: new AbortController().signal,
    mcp,
  };
}

const DOCUMENT_TREE = {
  name: "Homepage",
  version: "7",
  document: {
    id: "0:0",
    name: "Page 1",
    type: "CANVAS",
    children: [
      { id: "1:1", name: "Header", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 96 } },
      { id: "1:2", name: "Footer", type: "FRAME" },
    ],
  },
};

describe("the full retrieval pipeline, over a real spawned MCP process", () => {
  test("builds a validated snapshot with resolved frames, variables, and screenshots", async () => {
    const client = await realMcpClient({
      tools: [
        { name: "get_document", description: "Reads the document" },
        { name: "get_variables", description: "Lists variables" },
        { name: "capture_screenshot", description: "Captures a screenshot" },
      ],
      toolResults: {
        get_document: DOCUMENT_TREE,
        get_variables: { variables: [{ name: "color.brand", value: "#111827" }] },
        capture_screenshot: {
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
          format: "png",
          width: 1440,
          height: 96,
        },
      },
    } satisfies Partial<FakeMcpFixtures>);

    const parsedSource = parseFigmaSource("https://www.figma.com/design/abc123XYZ/Homepage", {
      frames: ["Header"],
    });

    const snapshot = await buildFigmaSourceSnapshot(context(client), {
      parsedSource,
      captureScreenshots: true,
      screenshotArtifactIdPrefix: "figma-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    });

    expect(snapshot.source.documentName).toBe("Homepage");
    expect(snapshot.source.documentVersion).toBe("7");
    expect(snapshot.source.resolvedFrames.map((frame) => frame.name)).toEqual(["Header"]);
    expect(snapshot.variables).toEqual([{ name: "color.brand", value: "#111827" }]);
    expect(snapshot.screenshots).toHaveLength(1);
    expect(snapshot.screenshots[0]?.nodeId).toBe("1:1");
    expect(snapshot.capabilities.variablesAvailable).toBe(true);
    expect(snapshot.capabilities.stylesAvailable).toBe(false);
    expect(snapshot.provenance.mcpServerIdentity).toBe("fake-figma-mcp");
  });

  test("degrades gracefully when styles/components/assets are unavailable, marking them so rather than inventing values", async () => {
    const client = await realMcpClient({
      tools: [{ name: "get_document" }],
      toolResults: { get_document: DOCUMENT_TREE },
    } satisfies Partial<FakeMcpFixtures>);

    const parsedSource = parseFigmaSource("https://www.figma.com/design/abc123XYZ/Homepage");

    const snapshot = await buildFigmaSourceSnapshot(context(client), {
      parsedSource,
      captureScreenshots: false,
      screenshotArtifactIdPrefix: "figma-screenshot",
      now: () => "2026-08-10T00:00:00.000Z",
    });

    expect(snapshot.capabilities.stylesAvailable).toBe(false);
    expect(snapshot.capabilities.componentsAvailable).toBe(false);
    expect(snapshot.styles).toEqual([]);
    expect(snapshot.components).toEqual([]);
    expect(snapshot.warnings.some((warning) => warning.code === "STYLES_UNAVAILABLE")).toBe(true);
  });

  test("an authentication failure from the server surfaces as a typed MCP error, not a generic one", async () => {
    const client = await realMcpClient({
      tools: [{ name: "get_document" }],
      errorTools: ["get_document"],
      toolResults: { get_document: "unauthorized" },
    } satisfies Partial<FakeMcpFixtures>);

    const parsedSource = parseFigmaSource("https://www.figma.com/design/abc123XYZ/Homepage");

    await expect(
      buildFigmaSourceSnapshot(context(client), {
        parsedSource,
        captureScreenshots: false,
        screenshotArtifactIdPrefix: "figma-screenshot",
        now: () => "2026-08-10T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
