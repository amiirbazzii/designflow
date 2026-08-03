// packages/mcp/src/stdio-runtime.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { McpRuntime } from "./stdio-runtime";
import type { FakeMcpFixtures } from "./fake-server-fixtures";

/**
 * Every test here spawns a *real, separate process* — the fake MCP server
 * in `fake-server-entry.ts` — and talks to it over real stdio pipes. This is
 * what "protocol-faithful fake" means in this repo: the transport under test
 * (`McpRuntime`) is exercised exactly as it would be against a real Figma
 * MCP server, only the process on the other end is a fixture-driven double
 * rather than Figma's own server.
 */

const FAKE_SERVER_PATH = fileURLToPath(new URL("./fake-server-entry.ts", import.meta.url));

const clients: McpRuntime[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

function client(fixtures: Partial<FakeMcpFixtures> = {}, requestTimeoutMs = 5_000): McpRuntime {
  const runtime = new McpRuntime({
    command: "bun",
    args: ["run", FAKE_SERVER_PATH],
    env: { FAKE_MCP_FIXTURES: JSON.stringify(fixtures) },
    requestTimeoutMs,
    serverIdentity: "fake-mcp-server",
  });
  clients.push(runtime);
  return runtime;
}

describe("connecting", () => {
  test("connects to a real spawned process and completes the handshake", async () => {
    const runtime = client();
    await expect(runtime.connect()).resolves.toBeUndefined();
  });

  test("a bad command fails with a launch error, not a hang", async () => {
    const runtime = new McpRuntime({ command: "this-binary-does-not-exist-anywhere" });
    clients.push(runtime);

    await expect(runtime.connect()).rejects.toThrow();
  });
});

describe("discovering tools", () => {
  test("lists the tools the fake server declares", async () => {
    const runtime = client({ tools: [{ name: "get_document" }, { name: "get_nodes" }] });
    const tools = await runtime.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["get_document", "get_nodes"]);
  });

  test("an empty tool list is a valid, distinct answer", async () => {
    const runtime = client({ tools: [] });
    const tools = await runtime.listTools();
    expect(tools).toEqual([]);
  });
});

describe("calling a tool", () => {
  test("a successful call returns normalized content", async () => {
    const runtime = client({
      tools: [{ name: "get_document" }],
      toolResults: { get_document: { name: "Homepage" } },
    });

    const result = await runtime.callTool({ toolName: "get_document", arguments: {} });
    expect(result).toMatchObject({ type: "success", toolName: "get_document", content: { name: "Homepage" } });
  });

  test("an unknown tool name fails with ERR_MCP_TOOL_NOT_FOUND, never invoked silently", async () => {
    const runtime = client({ unknownTools: ["not-a-real-tool"] });

    const result = await runtime.callTool({ toolName: "not-a-real-tool", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_TOOL_NOT_FOUND" });
  });

  test("an application-level tool error (isError: true) is reported as a typed failure", async () => {
    const runtime = client({
      tools: [{ name: "get_document" }],
      errorTools: ["get_document"],
      toolResults: { get_document: "unauthorized: bad token" },
    });

    const result = await runtime.callTool({ toolName: "get_document", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_AUTHENTICATION_FAILED" });
  });

  test("a request with a malformed shape throws before anything is sent", async () => {
    const runtime = client();
    await expect(
      runtime.callTool({ toolName: "", arguments: {} }),
    ).rejects.toThrow();
  });

  test("an oversized response is capped rather than accepted whole", async () => {
    const runtime = new McpRuntime({
      command: "bun",
      args: ["run", FAKE_SERVER_PATH],
      env: {
        FAKE_MCP_FIXTURES: JSON.stringify({
          tools: [{ name: "get_document" }],
          oversizedTools: ["get_document"],
          oversizedByteCount: 200,
        } satisfies Partial<FakeMcpFixtures>),
      },
      maxResponseBytes: 100,
    });
    clients.push(runtime);

    // The oversized line never survives to be parsed as a complete,
    // schema-valid response, so the call times out rather than succeeding
    // with truncated garbage — a size limit that fails safe, not one that
    // quietly hands back corrupted content.
    const result = await runtime.callTool(
      { toolName: "get_document", arguments: {} },
      undefined,
    );
    expect(result.type).toBe("failure");
  }, 15_000);

  test("a slow tool call times out rather than hanging forever", async () => {
    const runtime = client({ tools: [{ name: "slow" }], delayMs: { slow: 2_000 } }, 200);

    const result = await runtime.callTool({ toolName: "slow", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_TIMEOUT" });
  });

  test("aborting the signal cancels the in-flight call", async () => {
    const runtime = client({ tools: [{ name: "slow" }], delayMs: { slow: 2_000 } });
    const controller = new AbortController();

    const pending = runtime.callTool({ toolName: "slow", arguments: {} }, controller.signal);
    controller.abort();

    const result = await pending;
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_ABORTED" });
  });
});
