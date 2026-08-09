import type { McpClient } from "@designflow/sdk";

export type FigmaConnectionStatus = "connected" | "unavailable" | "not-configured";

/**
 * Performs exactly one bounded transport-owned MCP handshake.
 *
 * The transport remains responsible for localhost validation, protocol
 * negotiation, response limits, and safe error classification. This product
 * helper only turns that result into the small state the shell needs.
 */
export async function probeFigmaConnection(
  client: McpClient | undefined,
  signal?: AbortSignal,
): Promise<Exclude<FigmaConnectionStatus, "not-configured">> {
  if (client?.connect === undefined) return "unavailable";

  try {
    await client.connect(signal);
    return "connected";
  } catch {
    return "unavailable";
  }
}
