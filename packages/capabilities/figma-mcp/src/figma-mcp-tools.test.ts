// packages/capabilities/figma-mcp/src/figma-mcp-tools.test.ts
import { describe, expect, test } from "bun:test";
import { DesignFlowError } from "@designflow/sdk";
import { InMemoryMcpClient } from "../test/support/in-memory-mcp-client";
import { discoverFigmaMcpCapabilities } from "./discover-capabilities";
import { figmaMcpGetDocument, figmaMcpGetStyles, figmaMcpGetVariables } from "./figma-mcp-tools";
import { FigmaMcpUnsupportedOperationError } from "./errors";

describe("unsupported operations", () => {
  test("refuses to call an operation the discovered capabilities mark unavailable", async () => {
    const client = new InMemoryMcpClient({ tools: [] });
    const capabilities = await discoverFigmaMcpCapabilities(client);

    await expect(figmaMcpGetDocument(client, capabilities, { fileKey: "abc" })).rejects.toThrow(
      FigmaMcpUnsupportedOperationError,
    );
    expect(client.calls).toHaveLength(0);
  });
});

describe("successful calls", () => {
  test("get-document normalizes the returned tree", async () => {
    const client = new InMemoryMcpClient({
      tools: [{ name: "get_document" }],
      results: {
        get_document: {
          name: "Homepage",
          version: "42",
          document: { id: "0:0", name: "Page", type: "CANVAS", children: [{ id: "1:1", name: "Header", type: "FRAME" }] },
        },
      },
    });
    const capabilities = await discoverFigmaMcpCapabilities(client);

    const result = await figmaMcpGetDocument(client, capabilities, { fileKey: "abc" });
    expect(result.documentName).toBe("Homepage");
    expect(result.documentVersion).toBe("42");
    expect(result.nodes.map((node) => node.id)).toContain("1:1");
  });

  test("get-variables normalizes each variable", async () => {
    const client = new InMemoryMcpClient({
      tools: [{ name: "get_variables" }],
      results: { get_variables: { variables: [{ name: "color.brand", value: "#111" }] } },
    });
    const capabilities = await discoverFigmaMcpCapabilities(client);

    const result = await figmaMcpGetVariables(client, capabilities, { fileKey: "abc" });
    expect(result.variables).toEqual([{ name: "color.brand", value: "#111" }]);
  });

  test("an unrecognised response shape degrades to a warning, not a thrown error", async () => {
    const client = new InMemoryMcpClient({
      tools: [{ name: "get_styles" }],
      results: { get_styles: "not the expected shape at all" },
    });
    const capabilities = await discoverFigmaMcpCapabilities(client);

    const result = await figmaMcpGetStyles(client, capabilities, { fileKey: "abc" });
    expect(result.styles).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("MCP errors map to typed DesignFlow errors", () => {
  test("a tool-level failure becomes a thrown DesignFlowError carrying the MCP code", async () => {
    const client = new InMemoryMcpClient({
      tools: [{ name: "get_document" }],
      errorTools: ["get_document"],
    });
    const capabilities = await discoverFigmaMcpCapabilities(client);

    try {
      await figmaMcpGetDocument(client, capabilities, { fileKey: "abc" });
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_MCP_TOOL_FAILED");
    }
  });
});

describe("no arbitrary tool invocation", () => {
  test("the wrapper only ever calls the resolved tool name, never a caller-supplied one", async () => {
    const client = new InMemoryMcpClient({
      tools: [{ name: "real_document_tool" }],
      results: { real_document_tool: { document: { id: "0:0", name: "Page", type: "CANVAS" } } },
    });
    const capabilities = await discoverFigmaMcpCapabilities(client);

    await figmaMcpGetDocument(client, capabilities, { fileKey: "abc" });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.toolName).toBe("real_document_tool");
  });
});
