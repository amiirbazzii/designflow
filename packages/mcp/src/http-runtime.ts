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
  mcpInitializeResultSchema,
  mcpToolsCallResultSchema,
  mcpToolsListResultSchema,
  MCP_HTTP_PROTOCOL_VERSION,
  HTTP_SUPPORTED_MCP_PROTOCOL_VERSIONS,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";
import {
  classifyMcpJsonRpcError,
  classifyMcpToolFailure,
  McpConnectionError,
  McpProtocolRejectedError,
  McpProtocolUnsupportedError,
  McpRequestInvalidError,
} from "./errors";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;
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
  readonly status: number;
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
  private negotiatedProtocolVersion: string | undefined;
  private connected = false;
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
    if (this.connected && this.negotiatedProtocolVersion !== undefined) return;
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
        throw new McpProtocolRejectedError(
          "tools/list",
          200,
          response.error.code,
          response.error.message,
        );
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
      this.resetSession();
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
        const classified = classifyMcpJsonRpcError(response.error.code, response.error.message);
        return failure(
          validated.data.toolName,
          classified.code,
          classified.message,
          classified.retryable,
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
        const classified = classifyMcpToolFailure(parsedResult.data.content);
        return failure(
          validated.data.toolName,
          classified.code,
          classified.message,
          classified.retryable,
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
    const sessionId = this.sessionId;
    const protocolVersion = this.negotiatedProtocolVersion;
    this.resetSession();
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
    if (sessionId !== undefined && protocolVersion !== undefined) {
      void this.deleteSession(sessionId, protocolVersion);
    }
  }

  private resetSession(): void {
    this.sessionId = undefined;
    this.negotiatedProtocolVersion = undefined;
    this.connected = false;
    this.connectPromise = undefined;
  }

  private async initialize(signal?: AbortSignal): Promise<void> {
    this.resetSession();
    try {
      const exchange = await this.post(
        {
          jsonrpc: "2.0",
          id: this.nextId++,
          method: "initialize",
          params: {
            protocolVersion: MCP_HTTP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "designflow-ai", version: "0.1.2" },
          },
        },
        signal,
        this.connectTimeoutMs,
      );

      if (exchange.response?.error !== undefined || exchange.response === undefined) {
        if (exchange.response?.error !== undefined) {
          throw new McpProtocolRejectedError(
            "initialize",
            exchange.status,
            exchange.response.error.code,
            exchange.response.error.message,
          );
        }
        throw new McpConnectionError("the MCP initialize request returned no result");
      }

      const initializeResult = mcpInitializeResultSchema.safeParse(exchange.response.result);
      if (!initializeResult.success) {
        throw new McpConnectionError("the MCP initialize result did not match the expected shape");
      }
      const { protocolVersion } = initializeResult.data;
      if (!HTTP_SUPPORTED_MCP_PROTOCOL_VERSIONS.has(protocolVersion)) {
        throw new McpProtocolUnsupportedError(protocolVersion);
      }

      this.negotiatedProtocolVersion = protocolVersion;
      const sessionId = exchange.headers.get("MCP-Session-Id");
      if (sessionId !== null && sessionId.length > 0) this.sessionId = sessionId;

      const initialized = await this.post(
        { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
        signal,
        this.requestTimeoutMs,
        true,
      );
      if (initialized.response?.error !== undefined) {
        throw new McpProtocolRejectedError(
          "notifications/initialized",
          initialized.status,
          initialized.response.error.code,
          initialized.response.error.message,
        );
      }
      this.connected = true;
    } catch (error) {
      this.resetSession();
      if (error instanceof McpConnectionError || error instanceof McpProtocolRejectedError || error instanceof McpProtocolUnsupportedError) throw error;
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
      this.resetSession();
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
      if (this.negotiatedProtocolVersion !== undefined) {
        headers["MCP-Protocol-Version"] = this.negotiatedProtocolVersion;
      }

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
      const body = await readBoundedBody(response, this.maxResponseBytes);
      if (!response.ok) {
        throw protocolRejectedFromHttp(
          request.method,
          response.status,
          body,
          response.headers.get("content-type") ?? "",
        );
      }

      if (notification && body.byteLength === 0) {
        return { response: undefined, headers: response.headers, status: response.status };
      }
      if (body.byteLength === 0) throw new McpConnectionError("the MCP server returned an empty response");

      const parsed = parseResponseBody(body, response.headers.get("content-type") ?? "");
      return { response: parsed, headers: response.headers, status: response.status };
    } catch (error) {
      if (guard.timedOut()) throw new HttpTimeoutMarker();
      if (signal?.aborted) throw new HttpAbortMarker();
      if (error instanceof McpConnectionError || error instanceof McpProtocolRejectedError || error instanceof McpProtocolUnsupportedError) throw error;
      if (error instanceof HttpResponseTooLargeMarker) throw error;
      throw new McpConnectionError(classifyMessage(error));
    } finally {
      guard.cancel();
      this.activeControllers.delete((guard as TimeoutGuardWithController).controller);
    }
  }

  private async deleteSession(sessionId: string, protocolVersion: string): Promise<void> {
    const guard = createTimeoutGuard(undefined, this.requestTimeoutMs);
    this.activeControllers.add(guard.controller);
    try {
      const response = await fetch(this.endpoint, {
        method: "DELETE",
        headers: {
          Accept: "application/json, text/event-stream",
          "MCP-Session-Id": sessionId,
          "MCP-Protocol-Version": protocolVersion,
        },
        signal: guard.signal,
        redirect: "manual",
      });
      if (response.body !== null) await response.body.cancel();
    } catch {
      // Session deletion is best effort; local state is already cleared.
    } finally {
      guard.cancel();
      this.activeControllers.delete(guard.controller);
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

function protocolRejectedFromHttp(
  method: string,
  status: number,
  bytes: Uint8Array,
  contentType: string,
): McpProtocolRejectedError {
  let response: JsonRpcResponse | undefined;
  if (bytes.byteLength > 0) {
    try {
      response = parseResponseBody(bytes, contentType);
    } catch {
      // The bounded HTTP status is still useful when the body is not JSON-RPC.
    }
  }
  return new McpProtocolRejectedError(
    method,
    status,
    response?.error?.code,
    response?.error?.message,
  );
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
  if (error instanceof McpProtocolUnsupportedError) return "ERR_MCP_PROTOCOL_UNSUPPORTED";
  if (error instanceof McpProtocolRejectedError) return "ERR_MCP_PROTOCOL_REJECTED";
  return "ERR_MCP_CONNECTION_FAILED";
}

function classifyMessage(error: unknown): string {
  const code = classifyThrown(error);
  if (code === "ERR_MCP_TIMEOUT") return "the MCP request did not respond in time";
  if (code === "ERR_MCP_ABORTED") return "the MCP request was cancelled";
  if (code === "ERR_MCP_RESPONSE_TOO_LARGE") return "the MCP response exceeded the configured size limit";
  if (error instanceof McpProtocolRejectedError || error instanceof McpProtocolUnsupportedError) return error.message;
  return error instanceof McpConnectionError ? error.message : "the MCP HTTP request failed";
}

function failure(toolName: string, code: string, message: string, retryable: boolean, startedAt: number): McpToolCallResult {
  return mcpToolCallResultSchema.parse({ type: "failure", toolName, code, message, retryable, durationMs: performance.now() - startedAt });
}
