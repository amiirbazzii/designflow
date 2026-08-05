// packages/mcp/src/stdio-runtime.ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
  encodeRequest,
  jsonRpcResponseSchema,
  mcpToolsCallResultSchema,
  mcpToolsListResultSchema,
  type JsonRpcResponse,
} from "./protocol";
import {
  classifyMcpJsonRpcError,
  classifyMcpToolFailure,
  McpConnectionError,
  McpRequestInvalidError,
  McpServerLaunchError,
} from "./errors";

/**
 * Connects to an MCP server over stdio, using `node:child_process` — never
 * a Bun-only API — so the published CLI's bundle runs identically under
 * plain Node, exactly the constraint every other runtime dependency in this
 * repo already respects.
 *
 * One JSON-RPC 2.0 message per line, in both directions. Requests are
 * matched to responses by `id`; a response the runtime does not recognise
 * (no matching pending request) is logged and dropped rather than thrown,
 * since a server sending an unsolicited notification is not this client's
 * failure to report.
 */

export interface McpServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  /** Merged over the current process's environment — never replaces it wholesale. */
  readonly env?: Readonly<Record<string, string>>;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  /** Caps the size of one line of server output. Oversized lines fail the in-flight call, never the connection. */
  readonly maxResponseBytes?: number;
  /** A human label for provenance — never a credential, never derived from `env`. */
  readonly serverIdentity?: string;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;

interface Pending {
  readonly resolve: (response: JsonRpcResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class McpRuntime implements McpClient {
  public readonly serverIdentity?: string;

  private readonly config: McpServerConfig;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<string, Pending>();
  private buffer = "";
  private nextId = 1;
  private connectPromise: Promise<void> | undefined;

  public constructor(config: McpServerConfig) {
    this.config = config;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (config.serverIdentity !== undefined) this.serverIdentity = config.serverIdentity;
  }

  /** Idempotent — a second call while already connecting/connected returns the same promise/no-op. */
  public async connect(signal?: AbortSignal): Promise<void> {
    if (this.child !== undefined) return;
    if (this.connectPromise !== undefined) return this.connectPromise;

    this.connectPromise = this.doConnect(signal);
    return this.connectPromise;
  }

  private async doConnect(signal?: AbortSignal): Promise<void> {
    const child = await new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      let settled = false;

      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(this.config.command, [...(this.config.args ?? [])], {
          env: { ...process.env, ...this.config.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        reject(
          new McpServerLaunchError(
            this.config.command,
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }

      const onError = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(new McpServerLaunchError(this.config.command, error.message));
      };

      const onSpawn = (): void => {
        if (settled) return;
        settled = true;
        resolve(proc);
      };

      proc.once("error", onError);
      proc.once("spawn", onSpawn);
    });

    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.once("exit", () => this.onExit());

    const connectSignal = withTimeout(
      signal,
      this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    );

    try {
      await this.request("initialize", { protocolVersion: "2024-11-05" }, connectSignal.signal);
    } catch (error) {
      this.close();
      throw new McpConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      connectSignal.cancel();
    }
  }

  public async listTools(signal?: AbortSignal): Promise<readonly McpToolDescriptor[]> {
    await this.connect(signal);
    const response = await this.request("tools/list", {}, signal);
    const parsed = mcpToolsListResultSchema.safeParse(response.result);

    if (!parsed.success) {
      throw new McpConnectionError("the server's tools/list response did not match the expected shape");
    }

    return parsed.data.tools.map((tool) => mcpToolDescriptorSchema.parse(tool));
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
    } catch (error) {
      return failure(validated.data.toolName, "ERR_MCP_CONNECTION_FAILED", errorMessage(error), false, startedAt);
    }

    let response: JsonRpcResponse;
    try {
      response = await this.request(
        "tools/call",
        { name: validated.data.toolName, arguments: validated.data.arguments },
        signal,
        validated.data.timeoutMs,
      );
    } catch (error) {
      const code = classifyThrown(error);
      const message =
        code === "ERR_MCP_TIMEOUT"
          ? "the tool call did not respond in time"
          : code === "ERR_MCP_ABORTED"
            ? "the tool call was cancelled"
            : errorMessage(error);
      return failure(validated.data.toolName, code, message, true, startedAt);
    }

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
  }

  public close(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new McpConnectionError("the connection was closed"));
    }
    this.pending.clear();
    this.child?.kill();
    this.child = undefined;
    this.connectPromise = undefined;
    this.buffer = "";
  }

  private request(
    method: string,
    params: unknown,
    signal?: AbortSignal,
    timeoutOverrideMs?: number,
  ): Promise<JsonRpcResponse> {
    const child = this.child;
    if (child === undefined) {
      return Promise.reject(new McpConnectionError("not connected"));
    }

    const id = String(this.nextId++);

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeoutMs = timeoutOverrideMs ?? this.requestTimeoutMs;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpTimeoutMarker());
      }, timeoutMs);

      const onAbort = (): void => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new McpAbortMarker());
      };

      if (signal !== undefined) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new McpAbortMarker());
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pending.set(id, {
        resolve: (response) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(response);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        timer,
      });

      child.stdin.write(encodeRequest({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    if (this.buffer.length > this.maxResponseBytes) {
      // Bounded regardless of whether a newline ever arrives — an
      // unbounded buffer is exactly the resource exhaustion a size limit
      // exists to prevent.
      this.buffer = this.buffer.slice(-this.maxResponseBytes);
    }

    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    if (trimmed.length > this.maxResponseBytes) {
      // Oversized single line — fail whichever call sent the oldest pending
      // request rather than silently dropping it; there is no id to match
      // against a message this schema-invalid.
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return;
    }

    const parsed = jsonRpcResponseSchema.safeParse(raw);
    if (!parsed.success) return;

    const id = parsed.data.id;
    if (id === null) return;

    const pending = this.pending.get(String(id));
    if (pending === undefined) return;

    this.pending.delete(String(id));
    clearTimeout(pending.timer);
    pending.resolve(parsed.data);
  }

  private onExit(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new McpConnectionError("the server process exited"));
    }
    this.pending.clear();
    this.child = undefined;
    this.connectPromise = undefined;
  }
}

/** Distinguishes a timeout from every other rejection reason, without a string comparison. */
class McpTimeoutMarker extends Error {}
class McpAbortMarker extends Error {}

function classifyThrown(error: unknown): "ERR_MCP_TIMEOUT" | "ERR_MCP_ABORTED" | "ERR_MCP_CONNECTION_FAILED" {
  if (error instanceof McpTimeoutMarker) return "ERR_MCP_TIMEOUT";
  if (error instanceof McpAbortMarker) return "ERR_MCP_ABORTED";
  return "ERR_MCP_CONNECTION_FAILED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  toolName: string,
  code: string,
  message: string,
  retryable: boolean,
  startedAt: number,
): McpToolCallResult {
  return mcpToolCallResultSchema.parse({
    type: "failure",
    toolName,
    code,
    message,
    retryable,
    durationMs: performance.now() - startedAt,
  });
}

/** A child abort controller that also fires after `timeoutMs`, and can be cancelled without firing. */
function withTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onParentAbort = (): void => controller.abort();
  parent?.addEventListener("abort", onParentAbort, { once: true });

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}
