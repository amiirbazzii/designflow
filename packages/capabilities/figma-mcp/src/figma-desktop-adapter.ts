import {
  DesignFlowError,
  figmaSourceSnapshotSchema,
  type CapabilityContext,
  type FigmaScreenshotSnapshot,
  type FigmaSnapshotWarning,
  type FigmaSourceSnapshot,
  type McpClient,
} from "@designflow/sdk";

import type { ParsedFigmaSource } from "./parse-figma-source";
import { discoverFigmaMcpCapabilities } from "./discover-capabilities";
import { normalizeFigmaNodeTree } from "./normalize-nodes";
import { storeFigmaScreenshotArtifact } from "./screenshot-artifact";
import type { CapturedScreenshot } from "./figma-mcp-tools";
import { FigmaFrameSemanticMismatchError } from "./errors";

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

interface DesktopSelection {
  readonly id: string;
  readonly name: string;
  readonly type: string;
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
  // The official Desktop server is selection-oriented. Its `nodeId` field is
  // not a REST-style arbitrary node lookup; requesting an unselected node is
  // rejected by the server. Read the authenticated current selection first,
  // then enforce any URL node-id binding below.
  const desktopSelectionArgs = {};
  const metadata = await callDesktopTool(client, DESKTOP_TOOLS.metadata, desktopSelectionArgs, context.signal);
  const selection = parseDesktopSelection(metadata);
  if (selection === undefined) {
    throw new DesignFlowError(
      "ERR_FIGMA_DESKTOP_SELECTION_UNAVAILABLE",
      "Figma Desktop MCP did not return a recognizable selected node",
      { toolName: DESKTOP_TOOLS.metadata },
    );
  }

  if (options.parsedSource.nodeIds.length > 0 && !options.parsedSource.nodeIds.includes(selection.id)) {
    throw new DesignFlowError(
      "ERR_FIGMA_NODE_NOT_FOUND",
      `Figma Desktop MCP returned a different selected node than requested`,
      { requested: options.parsedSource.nodeIds, selected: selection.id },
    );
  }

  if (options.parsedSource.requestedFrames.length > 0 && !options.parsedSource.requestedFrames.includes(selection.name)) {
    throw new FigmaFrameSemanticMismatchError(options.parsedSource.requestedFrames, selection.name, selection.id);
  }

  const normalized = normalizeFigmaNodeTree({ id: selection.id, name: selection.name, type: selection.type });
  warnings.push(...normalized.warnings);
  warnings.push({
    code: "DESKTOP_MCP_SELECTION_SCOPE",
    message: "The official Desktop MCP server supplied the current selection, not a full file document",
    nodeId: selection.id,
  });

  const desktopNodeArgs = {
    nodeId: selection.id,
    clientLanguages: "typescript",
    clientFrameworks: "react",
  };
  if (capabilities.inspectNodes) {
    try {
      await callDesktopTool(client, DESKTOP_TOOLS.designContext, desktopNodeArgs, context.signal);
    } catch {
      warnings.push({
        code: "DESIGN_CONTEXT_RETRIEVAL_FAILED",
        message: "Figma Desktop MCP did not return detailed design context for the selected node",
        nodeId: selection.id,
      });
    }
  }

  const variables = capabilities.inspectVariables
    ? await readDesktopVariables(client, desktopNodeArgs, context.signal)
    : { variables: [], warnings: [] as FigmaSnapshotWarning[] };
  warnings.push(...variables.warnings);

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
      componentsAvailable: false,
      assetsAvailable: false,
      screenshotsAvailable: capabilities.captureScreenshot,
    },
    nodes: normalized.nodes,
    variables: variables.variables,
    styles: [],
    components: [],
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

function parseDesktopSelection(content: unknown): DesktopSelection | undefined {
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
): Promise<{ readonly variables: readonly []; readonly warnings: FigmaSnapshotWarning[] }> {
  try {
    const content = await callDesktopTool(client, DESKTOP_TOOLS.variables, arguments_, signal);
    const text = textFromContent(content);
    // Desktop MCP currently returns a human-readable variable definition
    // block, not the generic `{ variables: [...] }` envelope. Do not invent
    // typed values from prose; retain truthful availability and a warning.
    if (text.length > 0) {
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
