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

const OFFICIAL_DESKTOP_REQUIRED_TOOLS = [
  "get_design_context",
  "get_variable_defs",
  "get_screenshot",
  "get_metadata",
] as const;

function matches(tool: McpToolDescriptor, keywords: readonly string[]): boolean {
  const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function hasOfficialDesktopToolSet(tools: readonly McpToolDescriptor[]): boolean {
  const names = new Set(tools.map((tool) => tool.name));
  return OFFICIAL_DESKTOP_REQUIRED_TOOLS.every((toolName) => names.has(toolName));
}

function discoverOfficialDesktopCapabilities(tools: readonly McpToolDescriptor[]): FigmaMcpCapabilities {
  const names = new Set(tools.map((tool) => tool.name));
  const resolvedToolNames: Record<string, string> = {};
  const setIfPresent = (operation: string, toolName: string): boolean => {
    if (!names.has(toolName)) return false;
    resolvedToolNames[operation] = toolName;
    return true;
  };

  return {
    inspectDocument: setIfPresent("inspectDocument", "get_metadata"),
    inspectNodes: setIfPresent("inspectNodes", "get_design_context"),
    inspectVariables: setIfPresent("inspectVariables", "get_variable_defs"),
    inspectStyles: false,
    inspectComponents: false,
    exportAssets: false,
    captureScreenshot: setIfPresent("captureScreenshot", "get_screenshot"),
    resolvedToolNames,
  };
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

  // Figma Desktop MCP is a known, selection-oriented server. Exact tool
  // names take precedence over descriptions and over client identity: a
  // runtime wrapper or a test double may not set serverIdentity, and the
  // generic keyword rules would otherwise mistake get_design_context for a
  // screenshot/document tool.
  if (client.serverIdentity === "figma-desktop-mcp" || hasOfficialDesktopToolSet(tools)) {
    return discoverOfficialDesktopCapabilities(tools);
  }

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
