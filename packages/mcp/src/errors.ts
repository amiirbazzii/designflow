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
  "ERR_MCP_REQUEST_INVALID",
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
  "ERR_MCP_RESPONSE_INVALID",
  "ERR_MCP_RESPONSE_TOO_LARGE",
  "ERR_MCP_TIMEOUT",
  "ERR_MCP_ABORTED",
  "ERR_MCP_CONNECTION_FAILED",
] as const satisfies readonly McpErrorCode[];
