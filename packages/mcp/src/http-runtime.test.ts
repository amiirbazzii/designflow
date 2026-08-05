import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { HttpMcpRuntime } from "./http-runtime";
import { McpConnectionError } from "./errors";

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

interface RequestRecord {
  readonly method: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: Record<string, unknown>;
}

async function httpServer(
  handler: (request: RequestRecord, response: ServerResponse) => void,
): Promise<{ url: string; requests: RequestRecord[] }> {
  const requests: RequestRecord[] = [];
  const server = createServer((req, response) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    req.on("end", () => {
      const body = raw.length === 0 ? {} : JSON.parse(raw) as Record<string, unknown>;
      const request = { method: req.method ?? "", headers: req.headers, body };
      requests.push(request);
      handler(request, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a local address");
  return { url: `http://127.0.0.1:${address.port}/mcp`, requests };
}

function json(response: ServerResponse, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(200, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function initializeResponse(): unknown {
  return { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } };
}

function toolsListResponse(): unknown {
  return { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "get_document", description: "Read the current document", inputSchema: { type: "object" } }] } };
}

function callResponse(): unknown {
  return { jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ok" }] } };
}

function runtime(url: string, options: Partial<{ connectTimeoutMs: number; requestTimeoutMs: number; maxResponseBytes: number }> = {}): HttpMcpRuntime {
  return new HttpMcpRuntime({ url, serverIdentity: "fixture", ...options });
}

describe("HttpMcpRuntime", () => {
  test("initializes, stores the session header, sends initialized, lists tools and reuses the session", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") {
        json(response, initializeResponse(), { "MCP-Session-Id": "session-test-only" });
      } else if (request.body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
      } else if (request.body.method === "tools/list") {
        json(response, toolsListResponse());
      } else {
        json(response, callResponse());
      }
    });

    const client = runtime(fixture.url);
    const tools = await client.listTools();
    const toolsAgain = await client.listTools();

    expect(tools[0]?.name).toBe("get_document");
    expect(toolsAgain).toEqual(tools);
    expect(JSON.stringify(tools)).not.toContain("session-test-only");
    expect(fixture.requests.map((request) => request.body.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/list",
    ]);
    expect(fixture.requests[2]?.headers["mcp-session-id"]).toBe("session-test-only");
    expect(fixture.requests[3]?.headers["mcp-session-id"]).toBe("session-test-only");
    expect(fixture.requests[0]?.headers["mcp-protocol-version"]).toBeUndefined();
    expect(fixture.requests[1]?.headers["mcp-protocol-version"]).toBe("2025-03-26");
    expect(fixture.requests[2]?.headers["mcp-protocol-version"]).toBe("2025-03-26");
    expect(fixture.requests[3]?.headers["mcp-protocol-version"]).toBe("2025-03-26");
    expect(fixture.requests[2]?.headers.authorization).toBeUndefined();
    expect(fixture.requests[2]?.headers["figma-access-token"]).toBeUndefined();
    expect(fixture.requests[0]?.body.id).toBe(1);
    expect(fixture.requests[2]?.body.id).toBe(2);
    expect(fixture.requests[1]?.body.id).toBeUndefined();
  });

  test("sends the negotiated protocol and session headers for tools/call", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") json(response, initializeResponse(), { "MCP-Session-Id": "call-header-session" });
      else if (request.body.method === "notifications/initialized") { response.writeHead(204); response.end(); }
      else json(response, callResponse());
    });

    await runtime(fixture.url).callTool({ toolName: "get_metadata", arguments: {} });
    const call = fixture.requests.find((request) => request.body.method === "tools/call");
    expect(call?.headers["mcp-session-id"]).toBe("call-header-session");
    expect(call?.headers["mcp-protocol-version"]).toBe("2025-03-26");
  });

  test("handles an SSE tools/list response", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") {
        json(response, initializeResponse(), { "MCP-Session-Id": "sse-session" });
      } else if (request.body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
      } else {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(`event: message\ndata: ${JSON.stringify(toolsListResponse())}\n\n`);
      }
    });

    await expect(runtime(fixture.url).listTools()).resolves.toHaveLength(1);
  });

  test("calls tools and normalizes JSON-RPC errors without exposing server text", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") json(response, initializeResponse(), { "MCP-Session-Id": "call-session" });
      else if (request.body.method === "notifications/initialized") { response.writeHead(202); response.end(); }
      else json(response, { jsonrpc: "2.0", id: request.body.id, error: { code: -32601, message: "private local detail" } });
    });

    const result = await runtime(fixture.url).callTool({ toolName: "missing", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_TOOL_NOT_FOUND" });
    expect(JSON.stringify(result)).not.toContain("private local detail");
  });

  test("preserves a bounded safe reason for application-level tool errors", async () => {
    const providerLikeSecret = "sk-" + "or-v1-" + "secret";
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") json(response, initializeResponse(), { "MCP-Session-Id": "safe-session" });
      else if (request.body.method === "notifications/initialized") { response.writeHead(202); response.end(); }
      else json(response, {
        jsonrpc: "2.0",
        id: request.body.id,
        result: {
          isError: true,
          content: [
            { type: "text", text: `No compatible Figma node is currently selected at /Users/private/project ${providerLikeSecret} mcp-session-id=secret` },
            { type: "image", data: "secret-binary-payload", mimeType: "image/png" },
          ],
        },
      });
    });

    const result = await runtime(fixture.url).callTool({ toolName: "get_metadata", arguments: {} });
    expect(result).toMatchObject({
      type: "failure",
      code: "ERR_MCP_SELECTION_UNAVAILABLE",
      message: "No compatible Figma node is currently selected at <path> <redacted> session-id=<redacted>",
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain("secret-binary-payload");
    expect(JSON.stringify(result)).not.toContain("/Users/private");
    expect(JSON.stringify(result)).not.toContain(providerLikeSecret);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("keeps an invalid session distinct after recovery also fails", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") json(response, initializeResponse(), { "MCP-Session-Id": "invalid-session" });
      else if (request.body.method === "notifications/initialized") { response.writeHead(202); response.end(); }
      else json(response, { jsonrpc: "2.0", id: request.body.id, error: { code: -32001, message: "Invalid sessionId" } });
    });

    const result = await runtime(fixture.url).callTool({ toolName: "get_metadata", arguments: {} });
    expect(result).toMatchObject({ type: "failure", code: "ERR_MCP_SESSION_INVALID" });
  });

  test("recovers once from an invalid session", async () => {
    let initializeCount = 0;
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") {
        initializeCount += 1;
        json(response, initializeResponse(), { "MCP-Session-Id": `session-${initializeCount}` });
      } else if (request.body.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
      } else if (request.body.method === "tools/list" && initializeCount === 1) {
        json(response, { jsonrpc: "2.0", id: request.body.id, error: { code: -32001, message: "Invalid sessionId" } });
      } else {
        json(response, { ...toolsListResponse(), id: request.body.id });
      }
    });

    const tools = await runtime(fixture.url).listTools();
    expect(tools).toHaveLength(1);
    expect(initializeCount).toBe(2);
  });

  test("reports timeout, abort and oversized responses", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") json(response, initializeResponse(), { "MCP-Session-Id": "limits-session" });
      else if (request.body.method === "notifications/initialized") { response.writeHead(202); response.end(); }
      else if (request.body.method === "tools/call") {
        if (request.body.params && typeof request.body.params === "object" && (request.body.params as Record<string, unknown>).name === "slow") return;
        json(response, { jsonrpc: "2.0", id: request.body.id, result: { content: [{ type: "text", text: "x".repeat(500) }] } });
      } else json(response, { jsonrpc: "2.0", id: request.body.id, result: { tools: [] } });
    });

    const client = runtime(fixture.url, { requestTimeoutMs: 20, maxResponseBytes: 300 });
    const timeout = await client.callTool({ toolName: "slow", arguments: {} });
    expect(timeout).toMatchObject({ type: "failure", code: "ERR_MCP_TIMEOUT" });

    const controller = new AbortController();
    const pending = client.callTool({ toolName: "slow", arguments: {} }, controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ type: "failure", code: "ERR_MCP_ABORTED" });

    const oversized = await client.callTool({ toolName: "large", arguments: {} });
    expect(oversized).toMatchObject({ type: "failure", code: "ERR_MCP_RESPONSE_TOO_LARGE" });
  });

  test("requires a session header and close forces a fresh session", async () => {
    const missing = await httpServer((request, response) => {
      json(response, initializeResponse());
    });
    await expect(runtime(missing.url).connect()).resolves.toBeUndefined();

    let initializeCount = 0;
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") {
        initializeCount += 1;
        json(response, initializeResponse(), { "MCP-Session-Id": `fresh-${initializeCount}` });
      } else if (request.body.method === "notifications/initialized") { response.writeHead(202); response.end(); }
      else json(response, toolsListResponse());
    });
    const client = runtime(fixture.url);
    await client.connect();
    client.close();
    await client.connect();
    expect(initializeCount).toBe(2);
  });

  test("rejects an unsupported negotiated protocol version safely", async () => {
    const fixture = await httpServer((_request, response) => {
      json(response, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2099-01-01", capabilities: {} },
      }, { "MCP-Session-Id": "unsupported-version-session" });
    });

    await expect(runtime(fixture.url).connect()).rejects.toMatchObject({
      code: "ERR_MCP_PROTOCOL_UNSUPPORTED",
    });
  });

  test("rejects the stdio transport's protocol revision — HTTP support for it is unproven", async () => {
    const fixture = await httpServer((_request, response) => {
      json(response, {
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2024-11-05", capabilities: {} },
      }, { "MCP-Session-Id": "older-version-session" });
    });

    await expect(runtime(fixture.url).connect()).rejects.toMatchObject({
      code: "ERR_MCP_PROTOCOL_UNSUPPORTED",
    });
  });

  test("rejects a missing negotiated protocol version as an invalid initialize result", async () => {
    const fixture = await httpServer((_request, response) => {
      json(response, { jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
    });

    await expect(runtime(fixture.url).connect()).rejects.toMatchObject({
      code: "ERR_MCP_CONNECTION_FAILED",
    });
  });

  test("preserves bounded HTTP and JSON-RPC rejection details without response leakage", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.body.method === "initialize") {
        json(response, initializeResponse(), { "MCP-Session-Id": "protocol-rejection-session" });
      } else if (request.body.method === "notifications/initialized") {
        response.writeHead(204);
        response.end();
      } else {
        response.writeHead(400, { "Content-Type": "application/json", "MCP-Session-Id": "secret-session-header" });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: request.body.id,
          error: { code: -32600, message: "protocol version header missing at /Users/private" },
        }));
      }
    });

    await expect(runtime(fixture.url).listTools()).rejects.toMatchObject({
      code: "ERR_MCP_PROTOCOL_REJECTED",
      message: "tools/list was rejected: HTTP 400, JSON-RPC -32600, protocol version header missing at <path>",
    });
  });

  test("sends bounded session deletion and clears local state on close", async () => {
    const fixture = await httpServer((request, response) => {
      if (request.method === "DELETE") {
        response.writeHead(204);
        response.end();
      } else if (request.body.method === "initialize") {
        json(response, initializeResponse(), { "MCP-Session-Id": "delete-session" });
      } else {
        response.writeHead(204);
        response.end();
      }
    });

    const client = runtime(fixture.url);
    await client.connect();
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const deletion = fixture.requests.find((request) => request.method === "DELETE");
    expect(deletion?.headers["mcp-session-id"]).toBe("delete-session");
    expect(deletion?.headers["mcp-protocol-version"]).toBe("2025-03-26");
    await client.connect();
    expect(fixture.requests.filter((request) => request.body.method === "initialize")).toHaveLength(2);
  });

  test("accepts localhost and rejects external, credential-bearing and redirected endpoints", async () => {
    expect(() => new HttpMcpRuntime({ url: "http://localhost:3845/mcp" })).not.toThrow();
    expect(() => new HttpMcpRuntime({ url: "https://127.0.0.1:3845/mcp" })).toThrow(McpConnectionError);
    expect(() => new HttpMcpRuntime({ url: "http://user:pass@127.0.0.1:3845/mcp" })).toThrow(McpConnectionError);
    expect(() => new HttpMcpRuntime({ url: "http://example.com/mcp" })).toThrow(McpConnectionError);

    const redirect = await httpServer((_request, response) => {
      response.writeHead(302, { Location: "https://example.com/mcp" });
      response.end();
    });
    await expect(runtime(redirect.url).connect()).rejects.toThrow(McpConnectionError);
  });
});
