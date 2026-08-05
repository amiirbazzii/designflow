import {
  mcpToolCallRequestSchema,
  mcpToolCallResultSchema,
  mcpToolDescriptorSchema,
  type McpClient,
  type McpToolCallRequest,
  type McpToolCallResult,
  type McpToolDescriptor,
} from "@designflow/sdk";

import {
  jsonRpcResponseSchema,
  mcpToolsCallResultSchema,
  mcpToolsListResultSchema,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";
import { McpConnectionError, McpRequestInvalidError } from "./errors";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;
const INITIALIZE_PROTOCOL_VERSION = "2024-11-05";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export interface HttpMcpServerConfig {
  readonly url: string;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** A human label for provenance — never a URL credential or response header. */
  readonly serverIdentity?: string;
}

interface HttpExchange {
  readonly response: JsonRpcResponse | undefined;
  readonly headers: Headers;
}

type HttpRpcRequest = Omit<JsonRpcRequest, "id"> & Partial<Pick<JsonRpcRequest, "id">>;

interface TimeoutGuard {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly cancel: () => void;
}

/**
 * Streamable HTTP MCP transport for localhost desktop servers.
 *
 * The implementation deliberately owns only HTTP framing and MCP session
 * state. Tool discovery, Figma operation mapping and response normalization
 * remain in their existing capability layers.
 */
export class HttpMcpRuntime implements McpClient {
  public readonly serverIdentity?: string;

  private readonly endpoint: URL;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private sessionId: string | undefined;
  private connectPromise: Promise<void> | undefined;
  private nextId = 1;
  private readonly activeControllers = new Set<AbortController>();

  public constructor(config: HttpMcpServerConfig) {
    this.endpoint = assertLocalEndpoint(config.url);
    this.connectTimeoutMs = boundedPositive(config.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
    this.requestTimeoutMs = boundedPositive(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.maxResponseBytes = boundedPositive(config.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    if (config.serverIdentity !== undefined) this.serverIdentity = config.serverIdentity;
  }

  public async connect(signal?: AbortSignal): Promise<void> {
    if (this.sessionId !== undefined) return;
    if (this.connectPromise !== undefined) return this.connectPromise;

    this.connectPromise = this.initialize(signal).finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  public async listTools(signal?: AbortSignal): Promise<readonly McpToolDescriptor[]> {
    try {
      await this.connect(signal);
      const response = await this.requestWithRecovery("tools/list", {}, signal);
      if (response.error !== undefined) {
        throw new McpConnectionError("the MCP server rejected tools/list");
      }

      const parsed = mcpToolsListResultSchema.safeParse(response.result);
      if (!parsed.success) {
        throw new McpConnectionError("the server's tools/list response did not match the expected shape");
      }

      // Official Desktop MCP includes optional protocol metadata such as
      // `annotations`. Keep the existing provider-neutral descriptor narrow;
      // transport metadata is accepted on the wire but is not persisted or
      // exposed to Figma capability discovery.
      return parsed.data.tools.map((tool) =>
        mcpToolDescriptorSchema.parse({
          name: tool.name,
          ...(tool.description !== undefined ? { description: tool.description } : {}),
          ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof HttpResponseTooLargeMarker) {
        throw new McpConnectionError("the MCP response exceeded the configured size limit");
      }
      throw error;
    }
  }

  public async callTool(
    rawRequest: McpToolCallRequest,
    signal?: AbortSignal,
  ): Promise<McpToolCallResult> {
    const validated = mcpToolCallRequestSchema.safeParse(rawRequest);
    if (!validated.success) {
      throw new McpRequestInvalidError(
        validated.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }

    const startedAt = performance.now();
    try {
      await this.connect(signal);
      const response = await this.requestWithRecovery(
        "tools/call",
        { name: validated.data.toolName, arguments: validated.data.arguments },
        signal,
        validated.data.timeoutMs,
      );

      if (response.error !== undefined) {
        return failure(
          validated.data.toolName,
          classifyRpcError(response.error.code),
          "the server reported an error executing this tool",
          response.error.code >= -32099 && response.error.code <= -32000,
          startedAt,
        );
      }

      const parsedResult = mcpToolsCallResultSchema.safeParse(response.result);
      if (!parsedResult.success) {
        return failure(
          validated.data.toolName,
          "ERR_MCP_RESPONSE_INVALID",
          "the server's tools/call response did not match the expected shape",
          false,
          startedAt,
        );
      }

      if (parsedResult.data.isError === true) {
        return failure(
          validated.data.toolName,
          classifyToolErrorContent(parsedResult.data.content),
          "the server reported an error executing this tool",
          false,
          startedAt,
        );
      }

      return mcpToolCallResultSchema.parse({
        type: "success",
        toolName: validated.data.toolName,
        content: parsedResult.data.content,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      return failure(
        validated.data.toolName,
        classifyThrown(error),
        classifyMessage(error),
        true,
        startedAt,
      );
    }
  }

  public close(): void {
    this.sessionId = undefined;
    this.connectPromise = undefined;
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }

  private async initialize(signal?: AbortSignal): Promise<void> {
    this.sessionId = undefined;
    try {
      const exchange = await this.post(
        {
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "initialize",
          params: {
            protocolVersion: INITIALIZE_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "designflow-ai", version: "0.1.1" },
          },
        },
        signal,
        this.connectTimeoutMs,
      );

      if (exchange.response?.error !== undefined || exchange.response === undefined) {
        throw new McpConnectionError("the MCP initialize request was rejected");
      }

      const sessionId = exchange.headers.get("MCP-Session-Id");
      if (sessionId === null || sessionId.length === 0) {
        throw new McpConnectionError("the MCP server did not return a session identifier");
      }

      this.sessionId = sessionId;
      await this.post(
        { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
        signal,
        this.requestTimeoutMs,
        true,
      );
    } catch (error) {
      this.sessionId = undefined;
      if (error instanceof McpConnectionError) throw error;
      throw new McpConnectionError(classifyMessage(error));
    }
  }

  private async requestWithRecovery(
    method: string,
    params: unknown,
    signal?: AbortSignal,
    timeoutOverrideMs?: number,
  ): Promise<JsonRpcResponse> {
    const response = await this.post(
      { jsonrpc: "2.0", id: this.nextId++, method, params },
      signal,
      timeoutOverrideMs ?? this.requestTimeoutMs,
    );

    if (response.response?.error?.code === -32001 && this.sessionId !== undefined) {
      this.sessionId = undefined;
      await this.connect(signal);
      const retry = await this.post(
        { jsonrpc: "2.0", id: this.nextId++, method, params },
        signal,
        timeoutOverrideMs ?? this.requestTimeoutMs,
      );
      return retry.response ?? { jsonrpc: "2.0", id: null, error: { code: -32001, message: "invalid session" } };
    }

    return response.response ?? { jsonrpc: "2.0", id: null, error: { code: -32603, message: "empty MCP response" } };
  }

  private async post(
    request: HttpRpcRequest,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    notification = false,
  ): Promise<HttpExchange> {
    const guard = createTimeoutGuard(signal, timeoutMs);
    this.activeControllers.add((guard as TimeoutGuardWithController).controller);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (this.sessionId !== undefined) headers["MCP-Session-Id"] = this.sessionId;
      headers["MCP-Protocol-Version"] = INITIALIZE_PROTOCOL_VERSION;

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: guard.signal,
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        throw new McpConnectionError("the MCP server returned a redirect, which is not permitted");
      }
      if (!response.ok) {
        throw new McpConnectionError("the MCP server returned an HTTP error");
      }

      const body = await readBoundedBody(response, this.maxResponseBytes);
      if (notification && body.byteLength === 0) return { response: undefined, headers: response.headers };
      if (body.byteLength === 0) throw new McpConnectionError("the MCP server returned an empty response");

      const parsed = parseResponseBody(body, response.headers.get("content-type") ?? "");
      return { response: parsed, headers: response.headers };
    } catch (error) {
      if (guard.timedOut()) throw new HttpTimeoutMarker();
      if (signal?.aborted) throw new HttpAbortMarker();
      if (error instanceof McpConnectionError) throw error;
      if (error instanceof HttpResponseTooLargeMarker) throw error;
      throw new McpConnectionError(classifyMessage(error));
    } finally {
      guard.cancel();
      this.activeControllers.delete((guard as TimeoutGuardWithController).controller);
    }
  }
}

interface TimeoutGuardWithController extends TimeoutGuard {
  readonly controller: AbortController;
}

function createTimeoutGuard(parent: AbortSignal | undefined, timeoutMs: number): TimeoutGuardWithController {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", onAbort, { once: true });

  return {
    controller,
    signal: controller.signal,
    timedOut: () => timedOut,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new HttpResponseTooLargeMarker();

  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpResponseTooLargeMarker();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseResponseBody(bytes: Uint8Array, contentType: string): JsonRpcResponse {
  const text = new TextDecoder().decode(bytes);
  const raw = contentType.toLowerCase().startsWith("text/event-stream")
    ? parseSseData(text)
    : parseJson(text);
  const parsed = jsonRpcResponseSchema.safeParse(raw);
  if (!parsed.success) throw new McpConnectionError("the MCP response did not match JSON-RPC 2.0");
  return parsed.data;
}

function parseSseData(text: string): unknown {
  const data: string[] = [];
  const flush = (): unknown | undefined => {
    if (data.length === 0) return undefined;
    const value = data.join("\n");
    data.length = 0;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    else if (line.length === 0) {
      const parsed = flush();
      if (parsed !== undefined) return parsed;
    }
  }
  return flush() ?? (() => { throw new McpConnectionError("the MCP SSE response contained no JSON-RPC message"); })();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new McpConnectionError("the MCP response was not valid JSON");
  }
}

function assertLocalEndpoint(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new McpConnectionError("the HTTP MCP URL is invalid");
  }
  if (parsed.protocol !== "http:" || !LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new McpConnectionError("HTTP MCP transport permits only http://localhost or http://127.0.0.1");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new McpConnectionError("HTTP MCP URLs may not contain embedded credentials");
  }
  return parsed;
}

function boundedPositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

class HttpTimeoutMarker extends Error {}
class HttpResponseTooLargeMarker extends Error {}
class HttpAbortMarker extends Error {}

function classifyThrown(error: unknown): string {
  if (error instanceof HttpTimeoutMarker) return "ERR_MCP_TIMEOUT";
  if (error instanceof HttpAbortMarker) return "ERR_MCP_ABORTED";
  if (error instanceof HttpResponseTooLargeMarker) return "ERR_MCP_RESPONSE_TOO_LARGE";
  return "ERR_MCP_CONNECTION_FAILED";
}

function classifyMessage(error: unknown): string {
  const code = classifyThrown(error);
  if (code === "ERR_MCP_TIMEOUT") return "the MCP request did not respond in time";
  if (code === "ERR_MCP_ABORTED") return "the MCP request was cancelled";
  if (code === "ERR_MCP_RESPONSE_TOO_LARGE") return "the MCP response exceeded the configured size limit";
  return error instanceof McpConnectionError ? error.message : "the MCP HTTP request failed";
}

function classifyRpcError(code: number): "ERR_MCP_TOOL_NOT_FOUND" | "ERR_MCP_REQUEST_INVALID" | "ERR_MCP_CONNECTION_FAILED" {
  if (code === -32601) return "ERR_MCP_TOOL_NOT_FOUND";
  if (code === -32602) return "ERR_MCP_REQUEST_INVALID";
  return "ERR_MCP_CONNECTION_FAILED";
}

function classifyToolErrorContent(content: unknown): "ERR_MCP_AUTHENTICATION_FAILED" | "ERR_MCP_ACCESS_DENIED" | "ERR_MCP_RESPONSE_INVALID" {
  const text = summarize(content).toLowerCase();
  if (text.includes("unauthorized") || text.includes("authentication") || text.includes("401")) return "ERR_MCP_AUTHENTICATION_FAILED";
  if (text.includes("forbidden") || text.includes("access denied") || text.includes("403")) return "ERR_MCP_ACCESS_DENIED";
  return "ERR_MCP_RESPONSE_INVALID";
}

function summarize(content: unknown): string {
  if (typeof content === "string") return content;
  try { return JSON.stringify(content) ?? ""; } catch { return ""; }
}

function failure(toolName: string, code: string, message: string, retryable: boolean, startedAt: number): McpToolCallResult {
  return mcpToolCallResultSchema.parse({ type: "failure", toolName, code, message, retryable, durationMs: performance.now() - startedAt });
}
