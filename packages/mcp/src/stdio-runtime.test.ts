// packages/mcp/src/stdio-runtime.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { McpRuntime } from "./stdio-runtime";
import { McpConnectionError, McpProtocolUnsupportedError } from "./errors";
import {
  HTTP_SUPPORTED_MCP_PROTOCOL_VERSIONS,
  MCP_HTTP_PROTOCOL_VERSION,
  MCP_STDIO_PROTOCOL_VERSION,
  STDIO_SUPPORTED_MCP_PROTOCOL_VERSIONS,
} from "./protocol";
import type { FakeMcpFixtures } from "../test/fixtures/fake-server/fake-server-fixtures";

/**
 * Every test here spawns a *real, separate process* — the fake MCP server
 * in `fake-server-entry.ts` — and talks to it over real stdio pipes. This is
 * what "protocol-faithful fake" means in this repo: the transport under test
 * (`McpRuntime`) is exercised exactly as it would be against a real Figma
 * MCP server, only the process on the other end is a fixture-driven double
 * rather than Figma's own server.
 */

const FAKE_SERVER_PATH = fileURLToPath(new URL("../test/fixtures/fake-server/fake-server-entry.ts", import.meta.url));

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

describe("initialize validation", () => {
  test("a valid supported initialization still permits normal discovery and calls", async () => {
    const runtime = client({
      tools: [{ name: "get_document" }],
      toolResults: { get_document: { name: "Homepage" } },
    });

    await expect(runtime.connect()).resolves.toBeUndefined();
    const tools = await runtime.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["get_document"]);
    const result = await runtime.callTool({ toolName: "get_document", arguments: {} });
    expect(result.type).toBe("success");
  });

  test("an unsupported negotiated protocol version fails closed with the canonical error", async () => {
    const runtime = client({
      tools: [{ name: "get_document" }],
      initializeResult: { protocolVersion: "2099-01-01", capabilities: {} },
    });

    // Rejects with the protocol error, never with a tools/list shape error —
    // proof that no post-initialize request was sent.
    await expect(runtime.listTools()).rejects.toThrow(McpProtocolUnsupportedError);
  });

  test("a protocol mismatch surfaces through callTool as ERR_MCP_PROTOCOL_UNSUPPORTED, matching HTTP", async () => {
    const runtime = client({
      tools: [{ name: "get_document" }],
      initializeResult: { protocolVersion: "2099-01-01", capabilities: {} },
    });

    const result = await runtime.callTool({ toolName: "get_document", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_PROTOCOL_UNSUPPORTED" });
  });

  test("a missing protocolVersion fails closed as an invalid initialize result", async () => {
    const runtime = client({ initializeResult: { capabilities: {} } });

    await expect(runtime.connect()).rejects.toThrow(
      "the MCP initialize result did not match the expected shape",
    );
  });

  test("a non-string protocolVersion fails closed", async () => {
    const runtime = client({ initializeResult: { protocolVersion: 42, capabilities: {} } });
    await expect(runtime.connect()).rejects.toThrow(McpConnectionError);
  });

  test("a malformed initialize result fails closed", async () => {
    const runtime = client({ initializeResult: "not-an-object" });
    await expect(runtime.connect()).rejects.toThrow(McpConnectionError);
  });

  test("a JSON-RPC error response to initialize is rejected, not misparsed as a result", async () => {
    const runtime = client({ initializeError: true });

    // A connection error carrying only the safe JSON-RPC code — and a type
    // distinguishable from the unsupported-protocol failure.
    const rejection = runtime.connect();
    await expect(rejection).rejects.toThrow(McpConnectionError);
    await expect(rejection).rejects.not.toThrow(McpProtocolUnsupportedError);
    await rejection.catch((error: Error) => {
      expect(error.message).toContain("JSON-RPC -32601");
      expect(error.message).not.toContain("Method not found");
    });
  });

  test("failed initialization cleans up: no pending requests, and later calls fail fast without hanging", async () => {
    const runtime = client(
      { tools: [{ name: "get_document" }], initializeResult: { protocolVersion: "2099-01-01", capabilities: {} } },
      1_000,
    );

    await expect(runtime.connect()).rejects.toThrow(McpProtocolUnsupportedError);

    // The child was closed and nothing is pending: a follow-up operation
    // reruns the handshake against the same misbehaving server and fails
    // deterministically again — it never hangs on state left behind.
    const result = await runtime.callTool({ toolName: "get_document", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_PROTOCOL_UNSUPPORTED" });
  }, 10_000);

  test("each transport accepts exactly the version it requests, from the shared protocol module", () => {
    // Per-transport acceptance is deliberate: neither runtime has been
    // proven against the other's protocol revision, so neither set is
    // widened by inference.
    expect([...STDIO_SUPPORTED_MCP_PROTOCOL_VERSIONS]).toEqual([MCP_STDIO_PROTOCOL_VERSION]);
    expect([...HTTP_SUPPORTED_MCP_PROTOCOL_VERSIONS]).toEqual([MCP_HTTP_PROTOCOL_VERSION]);
  });

  test("the stdio transport does not accept the HTTP transport's protocol revision", async () => {
    const runtime = client({
      initializeResult: { protocolVersion: MCP_HTTP_PROTOCOL_VERSION, capabilities: {} },
    });
    await expect(runtime.connect()).rejects.toThrow(McpProtocolUnsupportedError);
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

  test("an application-level selection error keeps its safe server reason", async () => {
    const runtime = client({
      tools: [{ name: "get_metadata" }],
      errorTools: ["get_metadata"],
      toolResults: { get_metadata: "No compatible Figma node is currently selected" },
    });

    const result = await runtime.callTool({ toolName: "get_metadata", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_SELECTION_UNAVAILABLE", message: "No compatible Figma node is currently selected" });
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

  test("the spawned child receives only the baseline plus authorized variables", async () => {
    // Plant fabricated secrets in the parent (this test process) and prove
    // they never cross the spawn boundary, while an explicitly authorized
    // variable does — asserted against the child's actual process.env, not
    // redacted output.
    process.env["OPENROUTER_API_KEY"] = "sk-or-fake-parent-secret";
    process.env["AWS_SECRET_ACCESS_KEY"] = "aws-fake-parent-secret";
    process.env["CI_JOB_TOKEN"] = "ci-fake-parent-secret";
    process.env["DESIGNFLOW_TEST_UNRELATED_SECRET"] = "custom-fake-parent-secret";

    try {
      const runtime = new McpRuntime({
        command: "bun",
        args: ["run", FAKE_SERVER_PATH],
        env: {
          FAKE_MCP_FIXTURES: JSON.stringify({
            tools: [{ name: "echo_env" }],
            echoEnvTools: ["echo_env"],
          } satisfies Partial<FakeMcpFixtures>),
          DESIGNFLOW_TEST_AUTHORIZED: "authorized-value",
        },
        serverIdentity: "fake-mcp-server",
      });
      clients.push(runtime);

      const result = await runtime.callTool({ toolName: "echo_env", arguments: {} });
      expect(result.type).toBe("success");
      const childEnv = (result as { content: { env: Record<string, string> } }).content.env;

      expect(childEnv["PATH"]).toBeDefined();
      expect(childEnv["DESIGNFLOW_TEST_AUTHORIZED"]).toBe("authorized-value");
      expect(childEnv["FAKE_MCP_FIXTURES"]).toBeDefined();

      expect(childEnv["OPENROUTER_API_KEY"]).toBeUndefined();
      expect(childEnv["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
      expect(childEnv["CI_JOB_TOKEN"]).toBeUndefined();
      expect(childEnv["DESIGNFLOW_TEST_UNRELATED_SECRET"]).toBeUndefined();
    } finally {
      delete process.env["OPENROUTER_API_KEY"];
      delete process.env["AWS_SECRET_ACCESS_KEY"];
      delete process.env["CI_JOB_TOKEN"];
      delete process.env["DESIGNFLOW_TEST_UNRELATED_SECRET"];
    }
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
