// packages/mcp/src/errors.ts
import { DesignFlowError } from "@designflow/sdk";

/**
 * MCP transport failures, each with a stable code.
 *
 * The CLI's user-facing error table is checked against `MCP_ERROR_CODES` the
 * same way it already is against `AGENT_ERROR_CODES`/`MODEL_ERROR_CODES` — a
 * code added here without a message there fails a test rather than reaching
 * a person as a raw stack trace or a raw server message that might carry a
 * path, a header, or a credential fragment.
 */
export const MCP_ERROR_CODES = [
  "ERR_MCP_NOT_CONFIGURED",
  "ERR_MCP_SERVER_LAUNCH_FAILED",
  "ERR_MCP_CONNECTION_FAILED",
  "ERR_MCP_AUTHENTICATION_FAILED",
  "ERR_MCP_ACCESS_DENIED",
  "ERR_MCP_TOOL_NOT_FOUND",
  "ERR_MCP_TOOL_FAILED",
  "ERR_MCP_SELECTION_UNAVAILABLE",
  "ERR_MCP_NODE_NOT_FOUND",
  "ERR_MCP_SESSION_INVALID",
  "ERR_MCP_OPERATION_UNSUPPORTED",
  "ERR_MCP_REQUEST_INVALID",
  "ERR_MCP_PROTOCOL_REJECTED",
  "ERR_MCP_PROTOCOL_UNSUPPORTED",
  "ERR_MCP_RESPONSE_INVALID",
  "ERR_MCP_RESPONSE_TOO_LARGE",
  "ERR_MCP_TIMEOUT",
  "ERR_MCP_ABORTED",
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

/** No MCP server is configured for this installation at all. */
export class McpNotConfiguredError extends DesignFlowError {
  public constructor() {
    super("ERR_MCP_NOT_CONFIGURED", "No MCP server is configured", {});
    this.name = "McpNotConfiguredError";
    Object.setPrototypeOf(this, McpNotConfiguredError.prototype);
  }
}

/** The configured server command could not even be started (bad path, missing binary, ...). */
export class McpServerLaunchError extends DesignFlowError {
  public constructor(command: string, reason: string) {
    super(
      "ERR_MCP_SERVER_LAUNCH_FAILED",
      `Could not launch the configured MCP server (${command}): ${reason}`,
      { command },
    );
    this.name = "McpServerLaunchError";
    Object.setPrototypeOf(this, McpServerLaunchError.prototype);
  }
}

/** The server launched but the connection handshake did not complete. */
export class McpConnectionError extends DesignFlowError {
  public constructor(reason: string) {
    super("ERR_MCP_CONNECTION_FAILED", `Could not connect to the MCP server: ${reason}`, {});
    this.name = "McpConnectionError";
    Object.setPrototypeOf(this, McpConnectionError.prototype);
  }
}

/** A call was rejected because the request itself was malformed. Thrown, not returned — a caller bug. */
export class McpRequestInvalidError extends DesignFlowError {
  public constructor(issues: readonly string[]) {
    super("ERR_MCP_REQUEST_INVALID", `Invalid MCP tool call request: ${issues.join("; ")}`, {
      issues: [...issues],
    });
    this.name = "McpRequestInvalidError";
    Object.setPrototypeOf(this, McpRequestInvalidError.prototype);
  }
}

/**
 * The set of codes a call to `callTool`/`listTools` may resolve to as a
 * `{type: "failure"}` result rather than throw.
 *
 * Mirrors `PROVIDER_THROWABLE_CODES` in `@designflow/models`: these describe
 * something about *this call* that went wrong, which a deterministic
 * capability should be able to branch on, not a caller-side programming
 * error.
 */
export const MCP_CALL_FAILURE_CODES = [
  "ERR_MCP_AUTHENTICATION_FAILED",
  "ERR_MCP_ACCESS_DENIED",
  "ERR_MCP_TOOL_NOT_FOUND",
  "ERR_MCP_REQUEST_INVALID",
  "ERR_MCP_PROTOCOL_REJECTED",
  "ERR_MCP_PROTOCOL_UNSUPPORTED",
  "ERR_MCP_TOOL_FAILED",
  "ERR_MCP_SELECTION_UNAVAILABLE",
  "ERR_MCP_NODE_NOT_FOUND",
  "ERR_MCP_SESSION_INVALID",
  "ERR_MCP_OPERATION_UNSUPPORTED",
  "ERR_MCP_RESPONSE_INVALID",
  "ERR_MCP_RESPONSE_TOO_LARGE",
  "ERR_MCP_TIMEOUT",
  "ERR_MCP_ABORTED",
  "ERR_MCP_CONNECTION_FAILED",
] as const satisfies readonly McpErrorCode[];

export type McpToolFailure = {
  readonly code:
    | "ERR_MCP_AUTHENTICATION_FAILED"
    | "ERR_MCP_ACCESS_DENIED"
    | "ERR_MCP_TOOL_NOT_FOUND"
    | "ERR_MCP_REQUEST_INVALID"
    | "ERR_MCP_PROTOCOL_REJECTED"
    | "ERR_MCP_PROTOCOL_UNSUPPORTED"
    | "ERR_MCP_TOOL_FAILED"
    | "ERR_MCP_SELECTION_UNAVAILABLE"
    | "ERR_MCP_NODE_NOT_FOUND"
    | "ERR_MCP_SESSION_INVALID"
    | "ERR_MCP_OPERATION_UNSUPPORTED";
  readonly message: string;
  readonly retryable: boolean;
};

/**
 * Converts untrusted MCP error content into a short, safe diagnostic.
 * Only text content blocks are inspected; image/binary blocks are never
 * serialized, and paths/credential-shaped values are redacted before the
 * message crosses the MCP boundary.
 */
export function classifyMcpToolFailure(content: unknown): McpToolFailure {
  const text = safeMcpText(content);
  const normalized = text.toLowerCase();

  if (normalized.includes("session") && (normalized.includes("invalid") || normalized.includes("expired"))) {
    return { code: "ERR_MCP_SESSION_INVALID", message: text || "The MCP session is invalid or expired.", retryable: true };
  }
  if (normalized.includes("node not found") || normalized.includes("unknown node") || normalized.includes("invalid node")) {
    return { code: "ERR_MCP_NODE_NOT_FOUND", message: text || "The requested Figma node was not found.", retryable: false };
  }
  if (
    normalized.includes("no compatible") && normalized.includes("selected") ||
    normalized.includes("no node") && normalized.includes("selected") ||
    normalized.includes("selection") && (normalized.includes("unavailable") || normalized.includes("required"))
  ) {
    return { code: "ERR_MCP_SELECTION_UNAVAILABLE", message: text || "No compatible Figma node is currently selected.", retryable: false };
  }
  if (normalized.includes("unsupported") || normalized.includes("not supported")) {
    return { code: "ERR_MCP_OPERATION_UNSUPPORTED", message: text || "The MCP server does not support this operation.", retryable: false };
  }
  if (normalized.includes("unauthorized") || normalized.includes("authentication") || normalized.includes("401")) {
    return { code: "ERR_MCP_AUTHENTICATION_FAILED", message: text || "The MCP server rejected authentication.", retryable: false };
  }
  if (normalized.includes("forbidden") || normalized.includes("access denied") || normalized.includes("403")) {
    return { code: "ERR_MCP_ACCESS_DENIED", message: text || "The MCP server denied access.", retryable: false };
  }

  return {
    code: "ERR_MCP_TOOL_FAILED",
    message: text || "The MCP tool reported an error.",
    retryable: false,
  };
}

export function classifyMcpJsonRpcError(code: number, message?: string): McpToolFailure {
  if (code === -32001 || message?.toLowerCase().includes("invalid session") === true) {
    return { code: "ERR_MCP_SESSION_INVALID", message: "The MCP session is invalid or expired.", retryable: true };
  }
  if (code === -32601) return { code: "ERR_MCP_TOOL_NOT_FOUND", message: "The MCP tool was not found.", retryable: false };
  if (code === -32602) return { code: "ERR_MCP_REQUEST_INVALID", message: "The MCP tool request was rejected as invalid.", retryable: false };
  return classifyMcpToolFailure(message);
}

/** A bounded, safe rejection of an HTTP MCP request or notification. */
export class McpProtocolRejectedError extends DesignFlowError {
  public constructor(
    method: string,
    status: number,
    rpcCode?: number,
    reason?: string,
  ) {
    const safeReason = reason === undefined ? "" : sanitizeMcpText(reason);
    const detail = [
      `HTTP ${status}`,
      rpcCode === undefined ? undefined : `JSON-RPC ${rpcCode}`,
      safeReason.length === 0 ? undefined : safeReason,
    ].filter((part): part is string => part !== undefined).join(", ");
    super(
      "ERR_MCP_PROTOCOL_REJECTED",
      `${method} was rejected: ${detail}`,
      { method, status, ...(rpcCode === undefined ? {} : { rpcCode }) },
    );
    this.name = "McpProtocolRejectedError";
    Object.setPrototypeOf(this, McpProtocolRejectedError.prototype);
  }
}

/** The server negotiated a protocol version this runtime does not implement. */
export class McpProtocolUnsupportedError extends DesignFlowError {
  public constructor(protocolVersion: string) {
    super(
      "ERR_MCP_PROTOCOL_UNSUPPORTED",
      `The MCP server negotiated an unsupported protocol version: ${sanitizeMcpText(protocolVersion)}`,
      { protocolVersion: sanitizeMcpText(protocolVersion) },
    );
    this.name = "McpProtocolUnsupportedError";
    Object.setPrototypeOf(this, McpProtocolUnsupportedError.prototype);
  }
}

function safeMcpText(content: unknown): string {
  if (typeof content === "string") return sanitizeMcpText(content);
  const blocks = Array.isArray(content) ? content : [];
  const texts = blocks.flatMap((block) => {
    if (typeof block !== "object" || block === null) return [];
    const value = (block as { readonly type?: unknown; readonly text?: unknown });
    return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
  });
  const raw = texts.join(" ")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (raw.length === 0) return "";
  return sanitizeMcpText(raw);
}

export function sanitizeMcpText(raw: string): string {
  return raw
    .replace(/(?:\/Users|\/home|\/tmp|\/var|\/private\/var|\/Volumes|\/opt|[A-Za-z]:\\)[^\s"']+/g, "<path>")
    .replace(/\b(?:Bearer\s+)?(?:sk-[A-Za-z0-9_-]+|(?:sk|figd|figma)_[A-Za-z0-9_-]+)\b/gi, "<redacted>")
    .replace(/\b(?:mcp-session-id|sessionid|session-id)\s*[:=]\s*[A-Za-z0-9._-]+/gi, "session-id=<redacted>")
    .slice(0, 240);
}
