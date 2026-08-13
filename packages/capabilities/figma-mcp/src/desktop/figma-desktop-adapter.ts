import {
  DesignFlowError,
  figmaSourceSnapshotSchema,
  type CapabilityContext,
  type FigmaNodeSnapshot,
  type FigmaScreenshotSnapshot,
  type FigmaSnapshotWarning,
  type FigmaSourceSnapshot,
  type FigmaVariableSnapshot,
  type McpClient,
} from "@designflow/sdk";

import type { ParsedFigmaSource } from "../parse-figma-source";
import { discoverFigmaMcpCapabilities } from "../discover-capabilities";
import { normalizeFigmaNodeTree } from "../normalize-nodes";
import { parseDesktopMetadataOutline } from "./desktop-metadata-parser";
import { expandInstanceEvidence } from "./instance-evidence-expander";
import { parseDesignContextFacts, parseDesignContextTree, type DesignContextNodeFacts, type DesignContextTreeNode } from "./desktop-design-context-parser";
import { storeFigmaScreenshotArtifact } from "../screenshot-artifact";
import type { CapturedScreenshot } from "../figma-mcp-tools";
import { FigmaFrameSemanticMismatchError } from "../errors";

const DESKTOP_TOOLS = {
  metadata: "get_metadata",
  designContext: "get_design_context",
  screenshot: "get_screenshot",
  variables: "get_variable_defs",
} as const;

interface ContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly data?: unknown;
  readonly mimeType?: unknown;
}

export interface FigmaDesktopSelection {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/**
 * Reads the authenticated Desktop MCP selection using the same metadata tool
 * and parser as the source-snapshot adapter. A missing selection is a normal
 * product state; transport/tool failures remain classified by the existing
 * MCP boundary for callers that need the technical result.
 */
export async function readFigmaDesktopSelection(
  client: McpClient,
  signal?: AbortSignal,
): Promise<FigmaDesktopSelection | undefined> {
  const metadata = await callDesktopTool(client, DESKTOP_TOOLS.metadata, {}, signal);
  return parseDesktopSelection(metadata);
}

/**
 * A validated source-shaped identity for a Desktop selection. Desktop MCP
 * resolves the selected node from its authenticated session rather than from
 * a REST file lookup, so the reserved file-key segment is never sent to MCP;
 * it only keeps the selection on the existing ParsedFigmaSource path.
 */
export function figmaDesktopSelectionSource(selection: Pick<FigmaDesktopSelection, "id">): string {
  return `https://www.figma.com/design/desktopselection/current-selection?node-id=${selection.id.replace(":", "-")}`;
}

/**
 * Adapts the official Figma Desktop MCP server's current-selection protocol
 * to the existing source-snapshot contract. This is deliberately separate
 * from the generic REST-like wrappers: Desktop MCP does not expose a file
 * document by fileKey and its tool responses are content blocks.
 */
export async function buildFigmaDesktopSourceSnapshot(
  context: CapabilityContext,
  options: {
    readonly parsedSource: ParsedFigmaSource;
    readonly sourceKind?: "current-selection" | "figma-url";
    readonly captureScreenshots: boolean;
    readonly screenshotArtifactIdPrefix: string;
    readonly now: () => string;
  },
): Promise<FigmaSourceSnapshot> {
  const client = context.mcp;
  if (client === undefined) {
    throw new DesignFlowError(
      "ERR_FIGMA_MCP_REQUIRED",
      "Real Figma mode requires a configured MCP connection; placeholder fallback is disabled",
      {},
    );
  }

  const capabilities = await discoverFigmaMcpCapabilities(client, context.signal);
  const warnings: FigmaSnapshotWarning[] = [];
  const sourceKind = options.sourceKind ?? "current-selection";
  const requestedNodeId = options.parsedSource.nodeIds[0];
  if (sourceKind === "figma-url" && requestedNodeId === undefined) {
    throw new DesignFlowError(
      "ERR_FIGMA_NODE_NOT_FOUND",
      "A pasted Figma URL must identify a specific node for Desktop MCP retrieval",
      { requested: options.parsedSource.fileKey },
    );
  }

  // Desktop MCP accepts nodeId on metadata/design-context/variable/screenshot
  // calls. Only current-selection mode reads the implicit selection; a pasted
  // URL is bound to the parsed node instead.
  const metadata = await callDesktopTool(
    client,
    DESKTOP_TOOLS.metadata,
    sourceKind === "figma-url" ? { nodeId: requestedNodeId } : {},
    context.signal,
  );
  const metadataText = textFromContent(metadata);
  const outlineRoot = sourceKind === "figma-url" && requestedNodeId !== undefined
    ? parseDesktopMetadataOutline(metadataText, requestedNodeId)
    : undefined;
  const selection = outlineRoot === undefined
    ? parseDesktopSelection(metadata)
    : { id: outlineRoot.id, name: outlineRoot.name, type: outlineRoot.type };
  if (selection === undefined) {
    throw new DesignFlowError(
      "ERR_FIGMA_DESKTOP_SELECTION_UNAVAILABLE",
      "Figma Desktop MCP did not return a recognizable selected node",
      { toolName: DESKTOP_TOOLS.metadata },
    );
  }

  if (sourceKind === "current-selection" && options.parsedSource.nodeIds.length > 0 && !options.parsedSource.nodeIds.includes(selection.id)) {
    throw new DesignFlowError(
      "ERR_FIGMA_NODE_NOT_FOUND",
      "Figma Desktop MCP returned a different selected node than requested",
      { requested: options.parsedSource.nodeIds, selected: selection.id },
    );
  }

  if (sourceKind === "figma-url" && requestedNodeId !== undefined && selection.id !== requestedNodeId) {
    throw new DesignFlowError(
      "ERR_FIGMA_NODE_NOT_FOUND",
      "Figma Desktop MCP did not return the node requested by the pasted URL",
      { requested: [requestedNodeId], selected: selection.id },
    );
  }

  if (options.parsedSource.requestedFrames.length > 0 && !options.parsedSource.requestedFrames.includes(selection.name)) {
    throw new FigmaFrameSemanticMismatchError(options.parsedSource.requestedFrames, selection.name, selection.id);
  }

  // The metadata outline carries the full selected subtree — parse it into a
  // real node tree rather than reducing the selection to a single identity node.
  const resolvedOutlineRoot = outlineRoot ?? parseDesktopMetadataOutline(metadataText, selection.id);
  const normalized = normalizeFigmaNodeTree(
    resolvedOutlineRoot ?? { id: selection.id, name: selection.name, type: selection.type },
  );
  warnings.push(...normalized.warnings);
  if (resolvedOutlineRoot === undefined) {
    warnings.push({
      code: "METADATA_OUTLINE_UNPARSED",
      message: "Figma Desktop MCP metadata did not contain a parseable node outline; only the selection identity was retained",
      nodeId: selection.id,
    });
  }
  if (sourceKind === "current-selection") {
    warnings.push({
      code: "DESKTOP_MCP_SELECTION_SCOPE",
      message: "The official Desktop MCP server supplied the current selection, not a full file document",
      nodeId: selection.id,
    });
  }

  const desktopNodeArgs = {
    nodeId: selection.id,
    clientLanguages: "typescript",
    clientFrameworks: "react",
  };
  let contextFacts: ReadonlyMap<string, DesignContextNodeFacts> = new Map();
  let contextTree: readonly DesignContextTreeNode[] = [];
  if (capabilities.inspectNodes) {
    try {
      const content = await callDesktopTool(client, DESKTOP_TOOLS.designContext, desktopNodeArgs, context.signal);
      const contextText = textFromContent(content);
      contextFacts = parseDesignContextFacts(contextText);
      contextTree = parseDesignContextTree(contextText);
    } catch (error) {
      const cause = error instanceof DesignFlowError ? ` (${error.code})` : "";
      warnings.push({
        code: "DESIGN_CONTEXT_RETRIEVAL_FAILED",
        message: `Figma Desktop MCP did not return detailed design context for the selected node${cause}`,
        nodeId: selection.id,
      });
    }
  }
  const enriched = enrichNodesWithContextFacts(normalized.nodes, contextFacts);
  const expanded = expandInstanceEvidence(enriched, contextTree, warnings);
  const nodes = expanded.nodes;

  const variables = capabilities.inspectVariables
    ? await readDesktopVariables(client, desktopNodeArgs, context.signal)
    : { variables: [] as FigmaVariableSnapshot[], warnings: [] as FigmaSnapshotWarning[] };
  warnings.push(...variables.warnings);

  // Component identity: instance nodes in the outline are real component
  // references. The design-context tree upgrades them with the generated
  // component's name and its instance property values where exposed.
  const components = nodes
    .filter((node) => node.type === "INSTANCE")
    .map((node) => ({
      id: node.id,
      name: expanded.componentNames.get(node.id) ?? node.name,
      ...(node.variantProperties !== undefined ? { variantProperties: node.variantProperties } : {}),
    }));

  ensureMeaningfulEvidence(nodes, selection.id);

  const resolvedFrame = { id: selection.id, name: selection.name, path: [selection.name] };
  const screenshots: FigmaScreenshotSnapshot[] = [];
  if (options.captureScreenshots && capabilities.captureScreenshot) {
    let captured: CapturedScreenshot | undefined;
    try {
      captured = parseDesktopScreenshot(
        await callDesktopTool(
          client,
          DESKTOP_TOOLS.screenshot,
          { nodeId: selection.id, contentsOnly: true },
          context.signal,
        ),
      );
    } catch (error) {
      // Preserve the bounded, classified MCP application error. Only an
      // unexpected payload/parser failure is downgraded to a warning.
      if (error instanceof DesignFlowError && error.code.startsWith("ERR_MCP_")) {
        throw error;
      }
    }

    if (captured === undefined) {
      warnings.push({
        code: "SCREENSHOT_CAPTURE_FAILED",
        message: `Could not capture a Desktop MCP screenshot for ${selection.name}`,
        nodeId: selection.id,
      });
    } else {
      const stored = await storeFigmaScreenshotArtifact(context, {
        artifactId: `${options.screenshotArtifactIdPrefix}-${selection.id}`,
        nodeId: selection.id,
        fileKey: options.parsedSource.fileKey,
        frameName: selection.name,
        captured,
        toolIdentity: DESKTOP_TOOLS.screenshot,
        limits: {},
      });
      screenshots.push({
        nodeId: selection.id,
        artifactId: stored.payloadId,
        format: stored.format,
        ...(stored.width !== undefined ? { width: stored.width } : {}),
        ...(stored.height !== undefined ? { height: stored.height } : {}),
      });
    }
  } else if (options.captureScreenshots) {
    warnings.push({
      code: "SCREENSHOT_CAPTURE_UNAVAILABLE",
      message: "The Figma Desktop MCP server does not expose get_screenshot",
    });
  }

  const snapshot = figmaSourceSnapshotSchema.parse({
    source: {
      designFile: options.parsedSource.originalInput,
      originalInput: options.parsedSource.originalInput,
      ...(options.parsedSource.normalizedUrl !== undefined ? { normalizedUrl: options.parsedSource.normalizedUrl } : {}),
      fileKey: options.parsedSource.fileKey,
      nodeIds: options.parsedSource.nodeIds,
      frames: options.parsedSource.requestedFrames,
      resolvedFrames: [resolvedFrame],
    },
    capabilities: {
      variablesAvailable: capabilities.inspectVariables,
      stylesAvailable: false,
      componentsAvailable: components.length > 0,
      assetsAvailable: false,
      screenshotsAvailable: capabilities.captureScreenshot,
    },
    nodes,
    variables: variables.variables,
    styles: [],
    components,
    assets: [],
    screenshots,
    warnings,
    provenance: {
      mcpServerIdentity: "figma-desktop-mcp",
      retrievedAt: options.now(),
      toolVersions: {
        inspectDocument: DESKTOP_TOOLS.metadata,
        inspectNodes: DESKTOP_TOOLS.designContext,
        inspectVariables: DESKTOP_TOOLS.variables,
        captureScreenshot: DESKTOP_TOOLS.screenshot,
      },
    },
    sourceProvenance: {
      mode: "mcp-desktop",
      transport: "http",
      serverIdentity: "figma-desktop",
      requestedFileKey: options.parsedSource.fileKey,
      ...(options.parsedSource.nodeIds[0] !== undefined
        ? { requestedNodeId: options.parsedSource.nodeIds[0] }
        : {}),
      resolvedNodeId: selection.id,
    },
  });

  return snapshot;
}

async function callDesktopTool(
  client: McpClient,
  toolName: string,
  arguments_: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const result = await client.callTool({ toolName, arguments: arguments_ }, signal);
  if (result.type === "failure") {
    throw new DesignFlowError(result.code, result.message, { toolName });
  }
  return result.content;
}

function contentBlocks(content: unknown): readonly ContentBlock[] {
  return Array.isArray(content) ? content.filter(isContentBlock) : [];
}

function isContentBlock(value: unknown): value is ContentBlock {
  return typeof value === "object" && value !== null;
}

function textFromContent(content: unknown): string {
  return contentBlocks(content)
    .map((block) => typeof block.text === "string" ? block.text : "")
    .filter((text) => text.length > 0)
    .join("\n");
}

function parseDesktopSelection(content: unknown): FigmaDesktopSelection | undefined {
  const text = textFromContent(content);
  const selected = /^\s*-\s*(\d+:\d+)\s*:\s*(.+?)\s*$/m.exec(text);
  if (selected === null) return undefined;

  const id = selected[1]!;
  const name = selected[2]!;
  const typedTag = new RegExp(`<([A-Za-z][A-Za-z0-9_-]*)\\s+[^>]*\\bid=["']${escapeRegExp(id)}["']`, "i").exec(text);
  return { id, name, type: typedTag?.[1]?.toUpperCase() ?? "UNKNOWN" };
}

async function readDesktopVariables(
  client: McpClient,
  arguments_: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<{ readonly variables: FigmaVariableSnapshot[]; readonly warnings: FigmaSnapshotWarning[] }> {
  try {
    const content = await callDesktopTool(client, DESKTOP_TOOLS.variables, arguments_, signal);
    const text = textFromContent(content);
    // Desktop MCP returns variable definitions as one JSON object of
    // name → value inside a text block. Only that exact shape is read; any
    // other payload is reported as unrecognized rather than guessed at.
    if (text.length > 0) {
      const parsed = parseVariableDefinitions(text);
      if (parsed !== undefined) return { variables: parsed, warnings: [] };
      return {
        variables: [],
        warnings: [{ code: "VARIABLES_SHAPE_UNRECOGNIZED", message: "Desktop MCP returned variable definitions in a non-normalized text format" }],
      };
    }
  } catch {
    // The capability remains available in tools/list, but this retrieval is
    // optional and is reported without leaking the server's response.
  }
  return { variables: [], warnings: [{ code: "VARIABLES_RETRIEVAL_FAILED", message: "Desktop MCP variable definitions could not be retrieved" }] };
}

function parseVariableDefinitions(text: string): FigmaVariableSnapshot[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;

  const variables: FigmaVariableSnapshot[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (name.length === 0) continue;
    variables.push({
      name,
      value,
      ...(typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value) ? { type: "COLOR" } : {}),
    });
  }
  return variables;
}

/**
 * Supplements metadata-derived nodes with facts extracted from the design
 * context. The metadata outline is the structural source of truth; context
 * facts only fill fields the outline could not provide and never overwrite a
 * non-empty value with an empty one.
 */
function enrichNodesWithContextFacts(
  nodes: readonly FigmaNodeSnapshot[],
  facts: ReadonlyMap<string, DesignContextNodeFacts>,
): FigmaNodeSnapshot[] {
  return nodes.map((node) => {
    const fact = facts.get(node.id);
    if (fact === undefined) return node;

    const fills = [...node.fills];
    if (fills.length === 0) {
      if (fact.backgroundColor !== undefined) fills.push({ type: "SOLID", color: fact.backgroundColor });
      if (node.type === "TEXT" && fact.textColor !== undefined) fills.push({ type: "SOLID", color: fact.textColor });
    }
    const strokes = [...node.strokes];
    if (strokes.length === 0 && fact.borderColor !== undefined) {
      strokes.push({ type: "SOLID", color: fact.borderColor });
    }

    const typography: Record<string, unknown> = {};
    if (fact.fontFamily !== undefined) typography.fontFamily = fact.fontFamily;
    if (fact.fontStyle !== undefined) typography.fontStyle = fact.fontStyle;
    if (fact.fontSizePx !== undefined) typography.fontSize = fact.fontSizePx;

    return {
      ...node,
      fills,
      strokes,
      ...(node.characters === undefined && fact.characters !== undefined ? { characters: fact.characters } : {}),
      ...(node.cornerRadius === undefined && fact.cornerRadius !== undefined ? { cornerRadius: fact.cornerRadius } : {}),
      ...(node.itemSpacing === undefined && fact.itemSpacing !== undefined ? { itemSpacing: fact.itemSpacing } : {}),
      ...(node.layoutMode === undefined && fact.layoutMode !== undefined ? { layoutMode: fact.layoutMode } : {}),
      ...(node.opacity === undefined && fact.opacity !== undefined ? { opacity: fact.opacity } : {}),
      properties:
        Object.keys(typography).length > 0 && node.properties.typography === undefined
          ? { ...node.properties, typography }
          : node.properties,
    };
  });
}

/**
 * The minimum evidence bar for a usable snapshot: at least one signal beyond
 * bare URL/node identity (structure, geometry, text, or styling). A snapshot
 * below this bar would produce a misleading, effectively empty specification,
 * so the workflow fails honestly instead.
 */
function ensureMeaningfulEvidence(nodes: readonly FigmaNodeSnapshot[], selectionId: string): void {
  const meaningful =
    nodes.length > 1 ||
    nodes.some(
      (node) =>
        node.absoluteBoundingBox !== undefined ||
        node.characters !== undefined ||
        node.fills.length > 0 ||
        node.childIds.length > 0,
    );
  if (!meaningful) {
    throw new DesignFlowError(
      "ERR_FIGMA_EVIDENCE_INSUFFICIENT",
      "Figma MCP returned no design evidence beyond the node's identity; a specification from this snapshot would be empty",
      { nodeId: selectionId },
    );
  }
}

function parseDesktopScreenshot(content: unknown): CapturedScreenshot {
  const image = contentBlocks(content).find((block) => block.type === "image" && typeof block.data === "string");
  if (image === undefined || typeof image.data !== "string") throw new Error("Desktop MCP screenshot image missing");
  const mimeType = typeof image.mimeType === "string" ? image.mimeType.toLowerCase() : "image/png";
  const format = mimeType === "image/jpeg" ? "jpeg" : mimeType === "image/webp" ? "webp" : "png";
  return { base64Data: image.data, format };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
