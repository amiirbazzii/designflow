// packages/mcp/src/protocol.ts
import { z } from "zod";

/**
 * The wire shapes `McpRuntime` speaks over stdio.
 *
 * JSON-RPC 2.0, one message per line — the transport the reference
 * TypeScript MCP SDK's stdio servers use. A server framing messages with
 * `Content-Length` headers (the LSP-style framing some MCP transports also
 * use) would need a different reader; that is a documented limitation, not
 * something this stage claims to support. See the ADR for the exact
 * contract this implementation targets.
 *
 * These schemas validate structure only — "is this a JSON-RPC response
 * shape at all" — never the *content* of a tool's result, which is the
 * caller's job with its own Zod schema, the same layering `ModelResponse`
 * keeps from whatever a model actually said.
 */

export const jsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;

export const jsonRpcErrorSchema = z
  .object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .strict();

export const jsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]),
    result: z.unknown().optional(),
    error: jsonRpcErrorSchema.optional(),
  })
  .strict();

export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;

/**
 * The protocol version each transport requests during initialize. The two
 * transports genuinely speak different revisions today — stdio the earlier
 * line-delimited revision, Streamable HTTP the later one — so both are
 * represented explicitly rather than inferred.
 */
export const MCP_STDIO_PROTOCOL_VERSION = "2024-11-05";
export const MCP_HTTP_PROTOCOL_VERSION = "2025-03-26";

/**
 * The versions each transport accepts from a server's initialize
 * negotiation. Kept per-transport deliberately: each runtime has only been
 * proven against the revision it requests (the HTTP runtime's session
 * headers, `notifications/initialized`, and session DELETE follow the
 * Streamable HTTP semantics of its own revision), so neither set is
 * widened by inference. A server answering outside the set fails
 * initialization closed.
 */
export const STDIO_SUPPORTED_MCP_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  MCP_STDIO_PROTOCOL_VERSION,
]);
export const HTTP_SUPPORTED_MCP_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  MCP_HTTP_PROTOCOL_VERSION,
]);

/** The negotiated result returned by MCP initialize over Streamable HTTP. */
export const mcpInitializeResultSchema = z
  .object({
    protocolVersion: z.string().min(1),
    capabilities: z.record(z.string(), z.unknown()),
    serverInfo: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type McpInitializeResult = z.infer<typeof mcpInitializeResultSchema>;

/** The MCP-level shape of a successful `tools/list` result. */
export const mcpToolsListResultSchema = z.object({
  tools: z.array(
    z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  ),
});

/** The MCP-level shape of a successful `tools/call` result. */
export const mcpToolsCallResultSchema = z.object({
  content: z.unknown(),
  isError: z.boolean().optional(),
});

/** Builds one framed line of a JSON-RPC request, ready to write to a child process's stdin. */
export function encodeRequest(request: JsonRpcRequest): string {
  return `${JSON.stringify(jsonRpcRequestSchema.parse(request))}\n`;
}
