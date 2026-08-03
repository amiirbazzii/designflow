// packages/capabilities/figma-mcp/src/discover-capabilities.ts
import type { McpClient, McpToolDescriptor } from "@designflow/sdk";

/**
 * Maps a connected server's own tool names onto DesignFlow's stable, logical
 * Figma operations.
 *
 * Different MCP servers name their tools differently — this adapter is the
 * one place that assumption lives, so the rest of this package (and every
 * workflow capability built on it) only ever asks "can this server inspect
 * variables?", never "is the tool literally named `get_variables`?".
 * Matching is heuristic (a keyword search over the tool's own name and
 * description) because there is no registry of canonical Figma MCP tool
 * names to match against exactly — a future stage targeting one specific,
 * known server could tighten this to an exact name table.
 */

export interface FigmaMcpCapabilities {
  readonly inspectDocument: boolean;
  readonly inspectNodes: boolean;
  readonly inspectVariables: boolean;
  readonly inspectStyles: boolean;
  readonly inspectComponents: boolean;
  readonly exportAssets: boolean;
  readonly captureScreenshot: boolean;
  /** Logical operation -> the server's own tool name, for `figma-mcp-*` wrappers to call. */
  readonly resolvedToolNames: Readonly<Record<string, string>>;
}

interface KeywordRule {
  readonly operation: keyof Omit<FigmaMcpCapabilities, "resolvedToolNames">;
  readonly keywords: readonly string[];
}

const RULES: readonly KeywordRule[] = [
  { operation: "inspectDocument", keywords: ["document", "file"] },
  { operation: "inspectNodes", keywords: ["node", "frame", "selection"] },
  { operation: "inspectVariables", keywords: ["variable"] },
  { operation: "inspectStyles", keywords: ["style"] },
  { operation: "inspectComponents", keywords: ["component"] },
  { operation: "exportAssets", keywords: ["asset", "export", "image_ref", "download"] },
  { operation: "captureScreenshot", keywords: ["screenshot", "render", "image"] },
];

function matches(tool: McpToolDescriptor, keywords: readonly string[]): boolean {
  const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

/**
 * Connects (if not already connected — `listTools` connects lazily) and
 * discovers which logical Figma operations the configured server supports.
 *
 * An operation is only ever marked available when exactly one of the
 * server's tools matches its keywords unambiguously enough to be usable —
 * if two tools both look like a document inspector, this conservatively
 * leaves `resolvedToolNames` pointing at the first and still reports the
 * operation available, since a caller only ever needs one tool name per
 * operation, not proof of uniqueness.
 */
export async function discoverFigmaMcpCapabilities(
  client: McpClient,
  signal?: AbortSignal,
): Promise<FigmaMcpCapabilities> {
  const tools = await client.listTools(signal);

  const resolvedToolNames: Record<string, string> = {};
  const flags: Record<string, boolean> = {};

  for (const rule of RULES) {
    const found = tools.find((tool) => matches(tool, rule.keywords));
    flags[rule.operation] = found !== undefined;
    if (found !== undefined) resolvedToolNames[rule.operation] = found.name;
  }

  return {
    inspectDocument: flags.inspectDocument ?? false,
    inspectNodes: flags.inspectNodes ?? false,
    inspectVariables: flags.inspectVariables ?? false,
    inspectStyles: flags.inspectStyles ?? false,
    inspectComponents: flags.inspectComponents ?? false,
    exportAssets: flags.exportAssets ?? false,
    captureScreenshot: flags.captureScreenshot ?? false,
    resolvedToolNames,
  };
}
