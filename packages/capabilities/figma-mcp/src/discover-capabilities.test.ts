// packages/capabilities/figma-mcp/src/discover-capabilities.test.ts
import { describe, expect, test } from "bun:test";
import { InMemoryMcpClient } from "./in-memory-mcp-client.test-support";
import { discoverFigmaMcpCapabilities } from "./discover-capabilities";

describe("discovery", () => {
  test("maps a server's own tool names onto logical operations by keyword", async () => {
    const client = new InMemoryMcpClient({
      tools: [
        { name: "get_document" },
        { name: "get_variables" },
        { name: "export_image_ref" },
        { name: "capture_screenshot" },
      ],
    });

    const capabilities = await discoverFigmaMcpCapabilities(client);

    expect(capabilities.inspectDocument).toBe(true);
    expect(capabilities.inspectVariables).toBe(true);
    expect(capabilities.exportAssets).toBe(true);
    expect(capabilities.captureScreenshot).toBe(true);
    expect(capabilities.inspectStyles).toBe(false);
    expect(capabilities.inspectComponents).toBe(false);
  });

  test("resolvedToolNames maps each available operation to the server's actual tool name", async () => {
    const client = new InMemoryMcpClient({ tools: [{ name: "fetch_document_data" }] });
    const capabilities = await discoverFigmaMcpCapabilities(client);
    expect(capabilities.resolvedToolNames.inspectDocument).toBe("fetch_document_data");
  });

  test("an empty tool list marks every operation unavailable, never assumed", async () => {
    const client = new InMemoryMcpClient({ tools: [] });
    const capabilities = await discoverFigmaMcpCapabilities(client);
    expect(Object.values(capabilities.resolvedToolNames)).toEqual([]);
    expect(capabilities.inspectDocument).toBe(false);
    expect(capabilities.captureScreenshot).toBe(false);
  });

  test("a tool's description also contributes to matching, not only its name", async () => {
    const client = new InMemoryMcpClient({
      tools: [{ name: "op_7", description: "Lists the styles defined in a file" }],
    });
    const capabilities = await discoverFigmaMcpCapabilities(client);
    expect(capabilities.inspectStyles).toBe(true);
  });

  test("maps the official Desktop MCP tools by exact server-specific names", async () => {
    const client = new InMemoryMcpClient({
      tools: [
        { name: "get_figjam" },
        { name: "get_screenshot" },
        { name: "get_metadata" },
        { name: "get_motion_context" },
        { name: "get_variable_defs" },
        { name: "get_design_context" },
      ],
    });

    const capabilities = await discoverFigmaMcpCapabilities(client);

    expect(capabilities).toMatchObject({
      inspectDocument: true,
      inspectNodes: true,
      inspectVariables: true,
      captureScreenshot: true,
      inspectStyles: false,
      inspectComponents: false,
      exportAssets: false,
    });
    expect(capabilities.resolvedToolNames).toEqual({
      inspectDocument: "get_metadata",
      inspectNodes: "get_design_context",
      inspectVariables: "get_variable_defs",
      captureScreenshot: "get_screenshot",
    });
  });

  test("exact Desktop mappings are stable when tool order changes and unsupported tools stay unmapped", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "unrelated-wrapper",
      tools: [
        { name: "get_figjam", description: "exports images" },
        { name: "get_screenshot" },
        { name: "get_design_context" },
        { name: "get_metadata" },
        { name: "get_variable_defs" },
      ],
    });

    const capabilities = await discoverFigmaMcpCapabilities(client);

    expect(capabilities.resolvedToolNames).toEqual({
      inspectDocument: "get_metadata",
      inspectNodes: "get_design_context",
      inspectVariables: "get_variable_defs",
      captureScreenshot: "get_screenshot",
    });
    expect(capabilities.inspectStyles).toBe(false);
    expect(capabilities.inspectComponents).toBe(false);
    expect(capabilities.exportAssets).toBe(false);
  });
});
