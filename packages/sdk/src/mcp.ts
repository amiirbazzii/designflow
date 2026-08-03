// packages/sdk/src/mcp.ts
import { z } from "zod";

/**
 * The generic Model Context Protocol port.
 *
 * Deliberately protocol-level and provider-neutral: nothing here mentions
 * Figma, a design tool, or any specific server. A `McpClient` merely lists
 * whatever tools a connected server declares and calls one by name — the
 * same relationship `ModelProvider` has to `ModelInvoker`/`ModelRuntime`,
 * and the same reason it lives here rather than in a Figma-specific
 * package: swapping *which* MCP server is configured, or replacing the real
 * transport with a protocol-faithful fake in a test, must never mean
 * touching a workflow capability or an agent.
 *
 * What this file does **not** do: interpret what a tool's arguments or
 * response mean. `content` on a successful call is `unknown` — normalizing
 * it into a stable, typed shape is the caller's job (see
 * `@designflow/capability-figma-mcp`), exactly the way a `ModelResult`'s
 * `output` is `unknown` until the caller's own Zod schema has run.
 */

// ── Tool discovery ───────────────────────────────────────────────

/**
 * What a connected server says about one tool it exposes.
 *
 * `inputSchema` is carried opaquely (a JSON Schema object, like
 * `ModelRequest.responseSchema`) — DesignFlow does not implement a JSON
 * Schema validator and does not attempt to reconstruct a Zod schema from an
 * arbitrary server's declaration. A caller that needs to validate a tool's
 * arguments writes its own Zod schema for the one tool it actually calls;
 * this descriptor exists only so capability discovery can recognise which
 * of a server's tools correspond to which logical operation.
 */
export const mcpToolDescriptorSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type McpToolDescriptor = z.infer<typeof mcpToolDescriptorSchema>;

// ── Tool calls ───────────────────────────────────────────────────

export const mcpToolCallRequestSchema = z
  .object({
    toolName: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
    /** Overrides the client's own configured default, when a caller needs to be stricter. */
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type McpToolCallRequest = z.infer<typeof mcpToolCallRequestSchema>;

/**
 * The outcome of one tool call, normalised.
 *
 * A discriminated union, mirroring `ModelResult`/`ToolResult`: a caller
 * cannot read `content` without having established the call actually
 * succeeded, and a failure carries a stable `ERR_MCP_*` code rather than a
 * server's own error text — the server's raw message is never trusted to be
 * free of a path, a header value or an internal hostname, so it is
 * summarised into `message` rather than passed through.
 */
export const mcpToolCallResultSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("success"),
      toolName: z.string().min(1),
      content: z.unknown(),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("failure"),
      toolName: z.string().min(1),
      /** A stable `ERR_MCP_*` code. Never matched on message text. */
      code: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean(),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
]);

export type McpToolCallResult = z.infer<typeof mcpToolCallResultSchema>;

// ── The port ─────────────────────────────────────────────────────

/**
 * What a workflow capability is handed to reach a connected MCP server.
 *
 * A service port, not a transport handle — a capability never sees a child
 * process, a socket or a request id counter, the same reason `AgentToolService`
 * exposes exactly one verb rather than a registry. `@designflow/mcp`'s
 * `McpRuntime` is the real implementation; a test constructs a
 * protocol-faithful fake implementing the same three methods instead.
 */
export interface McpClient {
  /** The server identity this client is connected to, for provenance — never a credential. */
  readonly serverIdentity?: string;

  listTools(signal?: AbortSignal): Promise<readonly McpToolDescriptor[]>;

  callTool(
    request: McpToolCallRequest,
    signal?: AbortSignal,
  ): Promise<McpToolCallResult>;
}
