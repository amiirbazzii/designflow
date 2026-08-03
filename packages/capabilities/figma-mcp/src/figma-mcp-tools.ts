// packages/capabilities/figma-mcp/src/figma-mcp-tools.ts
import { z } from "zod";
import {
  DesignFlowError,
  type FigmaAssetSnapshot,
  type FigmaComponentSnapshot,
  type FigmaSnapshotWarning,
  type FigmaStyleSnapshot,
  type FigmaVariableSnapshot,
  type McpClient,
} from "@designflow/sdk";

import type { FigmaMcpCapabilities } from "./discover-capabilities";
import { normalizeFigmaNodeTree, type NormalizedNodes } from "./normalize-nodes";
import { FigmaMcpUnsupportedOperationError } from "./errors";

/**
 * Deterministic, permission-scoped wrappers over one connected MCP client's
 * tools — `figma-mcp-get-document`, `figma-mcp-get-nodes`, and so on from
 * the Stage 3 spec, expressed as plain functions rather than registered
 * `Tool` objects.
 *
 * That is a deliberate choice, not an oversight: these are called by a
 * *workflow capability*, a deterministic adapter, never by an agent's model
 * output choosing a tool name at runtime. `@designflow/tools`'
 * `Tool`/`ToolRuntime` machinery exists for the opposite relationship — an
 * agent consulting a tool while deciding — and reusing it here would let a
 * capability's tool selection be described as something an agent chooses,
 * which it structurally cannot: the Figma Specification Agent never sees
 * `client` or any of these functions at all (see
 * `figma-specification-strategy.ts`'s import list).
 *
 * Every wrapper:
 *   - refuses up front if `capabilities` marks the operation unsupported
 *     (`FigmaMcpUnsupportedOperationError`, never a silent empty result);
 *   - calls exactly one resolved tool name, never a name the caller supplies;
 *   - turns a `{type: "failure"}` outcome into a thrown, typed
 *     `DesignFlowError` carrying the MCP layer's own stable code;
 *   - normalizes a successful `content` into DesignFlow's own snapshot
 *     shapes, tolerantly — see `normalize-nodes.ts` for the node case.
 */

function requireTool(capabilities: FigmaMcpCapabilities, operation: string, available: boolean): string {
  if (!available) throw new FigmaMcpUnsupportedOperationError(operation);
  const toolName = capabilities.resolvedToolNames[operation];
  if (toolName === undefined) throw new FigmaMcpUnsupportedOperationError(operation);
  return toolName;
}

async function call(
  client: McpClient,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const result = await client.callTool({ toolName, arguments: args }, signal);

  if (result.type === "failure") {
    throw new DesignFlowError(result.code, `Figma MCP tool "${toolName}" failed`, { toolName });
  }

  return result.content;
}

// ── figma-mcp-get-document / figma-mcp-get-nodes ─────────────────

export interface DocumentRetrieval extends NormalizedNodes {
  readonly documentName?: string;
  readonly documentVersion?: string;
  readonly lastModified?: string;
}

const documentEnvelopeSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    lastModified: z.string().optional(),
    document: z.unknown().optional(),
  })
  .passthrough();

export async function figmaMcpGetDocument(
  client: McpClient,
  capabilities: FigmaMcpCapabilities,
  params: { readonly fileKey: string },
  signal?: AbortSignal,
): Promise<DocumentRetrieval> {
  const toolName = requireTool(capabilities, "inspectDocument", capabilities.inspectDocument);
  const content = await call(client, toolName, { fileKey: params.fileKey }, signal);

  const envelope = documentEnvelopeSchema.safeParse(content);
  const root = envelope.success ? (envelope.data.document ?? content) : content;
  const { nodes, warnings } = normalizeFigmaNodeTree(root);

  return {
    nodes,
    warnings,
    ...(envelope.success && envelope.data.name !== undefined ? { documentName: envelope.data.name } : {}),
    ...(envelope.success && envelope.data.version !== undefined ? { documentVersion: envelope.data.version } : {}),
    ...(envelope.success && envelope.data.lastModified !== undefined
      ? { lastModified: envelope.data.lastModified }
      : {}),
  };
}

export async function figmaMcpGetNodes(
  client: McpClient,
  capabilities: FigmaMcpCapabilities,
  params: { readonly fileKey: string; readonly nodeIds: readonly string[] },
  signal?: AbortSignal,
): Promise<NormalizedNodes> {
  const toolName = requireTool(capabilities, "inspectNodes", capabilities.inspectNodes);
  const content = await call(
    client,
    toolName,
    { fileKey: params.fileKey, nodeIds: [...params.nodeIds] },
    signal,
  );

  const asArray = Array.isArray(content) ? content : [content];
  const nodes: NormalizedNodes["nodes"][number][] = [];
  const warnings: FigmaSnapshotWarning[] = [];

  for (const entry of asArray) {
    const normalized = normalizeFigmaNodeTree(entry);
    nodes.push(...normalized.nodes);
    warnings.push(...normalized.warnings);
  }

  return { nodes, warnings };
}

// ── figma-mcp-get-variables ───────────────────────────────────────

const variablesEnvelopeSchema = z.object({
  variables: z
    .array(
      z
        .object({
          name: z.string().min(1),
          value: z.unknown(),
          type: z.string().optional(),
          collection: z.string().optional(),
        })
        .passthrough(),
    )
    .default([]),
});

export async function figmaMcpGetVariables(
  client: McpClient,
  capabilities: FigmaMcpCapabilities,
  params: { readonly fileKey: string },
  signal?: AbortSignal,
): Promise<{ readonly variables: readonly FigmaVariableSnapshot[]; readonly warnings: readonly FigmaSnapshotWarning[] }> {
  const toolName = requireTool(capabilities, "inspectVariables", capabilities.inspectVariables);
  const content = await call(client, toolName, { fileKey: params.fileKey }, signal);

  const parsed = variablesEnvelopeSchema.safeParse(content);
  if (!parsed.success) {
    return { variables: [], warnings: [{ code: "VARIABLES_SHAPE_UNRECOGNIZED", message: "The server's variables response did not match the expected shape" }] };
  }

  return {
    variables: parsed.data.variables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      ...(variable.type !== undefined ? { type: variable.type } : {}),
      ...(variable.collection !== undefined ? { collection: variable.collection } : {}),
    })),
    warnings: [],
  };
}

// ── figma-mcp-get-styles ───────────────────────────────────────────

const stylesEnvelopeSchema = z.object({
  styles: z
    .array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          styleType: z.string().min(1).optional(),
          type: z.string().min(1).optional(),
          value: z.record(z.unknown()).optional(),
        })
        .passthrough(),
    )
    .default([]),
});

export async function figmaMcpGetStyles(
  client: McpClient,
  capabilities: FigmaMcpCapabilities,
  params: { readonly fileKey: string },
  signal?: AbortSignal,
): Promise<{ readonly styles: readonly FigmaStyleSnapshot[]; readonly warnings: readonly FigmaSnapshotWarning[] }> {
  const toolName = requireTool(capabilities, "inspectStyles", capabilities.inspectStyles);
  const content = await call(client, toolName, { fileKey: params.fileKey }, signal);

  const parsed = stylesEnvelopeSchema.safeParse(content);
  if (!parsed.success) {
    return { styles: [], warnings: [{ code: "STYLES_SHAPE_UNRECOGNIZED", message: "The server's styles response did not match the expected shape" }] };
  }

  return {
    styles: parsed.data.styles.map((style) => ({
      id: style.id,
      name: style.name,
      styleType: style.styleType ?? style.type ?? "UNKNOWN",
      ...(style.value !== undefined ? { value: style.value } : {}),
    })),
    warnings: [],
  };
}

// ── figma-mcp-get-components ──────────────────────────────────────

const componentsEnvelopeSchema = z.object({
  components: z
    .array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          key: z.string().optional(),
          description: z.string().optional(),
          componentProperties: z.record(z.string()).optional(),
        })
        .passthrough(),
    )
    .default([]),
});

export async function figmaMcpGetComponents(
  client: McpClient,
  capabilities: FigmaMcpCapabilities,
  params: { readonly fileKey: string },
  signal?: AbortSignal,
): Promise<{ readonly components: readonly FigmaComponentSnapshot[]; readonly warnings: readonly FigmaSnapshotWarning[] }> {
  const toolName = requireTool(capabilities, "inspectComponents", capabilities.inspectComponents);
  const content = await call(client, toolName, { fileKey: params.fileKey }, signal);

  const parsed = componentsEnvelopeSchema.safeParse(content);
  if (!parsed.success) {
    return { components: [], warnings: [{ code: "COMPONENTS_SHAPE_UNRECOGNIZED", message: "The server's components response did not match the expected shape" }] };
  }

  return {
    components: parsed.data.components.map((component) => ({
      id: component.id,
      name: component.name,
      ...(component.key !== undefined ? { key: component.key } : {}),
      ...(component.description !== undefined ? { description: component.description } : {}),
      ...(component.componentProperties !== undefined
        ? { variantProperties: component.componentProperties }
        : {}),
    })),
    warnings: [],
  };
}

// ── figma-mcp-get-assets ───────────────────────────────────────────

const assetsEnvelopeSchema = z.object({
  assets: z
    .array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          type: z.string().min(1).optional(),
          reference: z.string().optional(),
          format: z.enum(["png", "jpeg", "webp", "svg"]).optional(),
        })
        .passthrough(),
    )
    .default([]),
});

export async function figmaMcpGetAssets(
  client: McpClient,
  capabilities: FigmaMcpCapabilities,
  params: { readonly fileKey: string; readonly nodeIds: readonly string[] },
  signal?: AbortSignal,
): Promise<{ readonly assets: readonly FigmaAssetSnapshot[]; readonly warnings: readonly FigmaSnapshotWarning[] }> {
  const toolName = requireTool(capabilities, "exportAssets", capabilities.exportAssets);
  const content = await call(
    client,
    toolName,
    { fileKey: params.fileKey, nodeIds: [...params.nodeIds] },
    signal,
  );

  const parsed = assetsEnvelopeSchema.safeParse(content);
  if (!parsed.success) {
    return { assets: [], warnings: [{ code: "ASSETS_SHAPE_UNRECOGNIZED", message: "The server's assets response did not match the expected shape" }] };
  }

  return {
    assets: parsed.data.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type ?? "asset",
      ...(asset.reference !== undefined ? { reference: asset.reference } : {}),
      ...(asset.format !== undefined ? { format: asset.format } : {}),
    })),
    warnings: [],
  };
}

// ── figma-mcp-capture-screenshot ───────────────────────────────────

const screenshotEnvelopeSchema = z.object({
  data: z.string().min(1),
  format: z.enum(["png", "jpeg", "webp"]).default("png"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export interface CapturedScreenshot {
  /** Base64-encoded image bytes, as the server returned them. Never logged, never traced. */
  readonly base64Data: string;
  readonly format: "png" | "jpeg" | "webp";
  readonly width?: number;
  readonly height?: number;
}

export async function figmaMcpCaptureScreenshot(
  client: McpClient,
  capabilities: FigmaMcpCapabilities,
  params: { readonly fileKey: string; readonly nodeId: string },
  signal?: AbortSignal,
): Promise<CapturedScreenshot | undefined> {
  if (!capabilities.captureScreenshot) return undefined;
  const toolName = capabilities.resolvedToolNames.captureScreenshot;
  if (toolName === undefined) return undefined;

  const content = await call(
    client,
    toolName,
    { fileKey: params.fileKey, nodeId: params.nodeId },
    signal,
  );

  const parsed = screenshotEnvelopeSchema.safeParse(content);
  if (!parsed.success) return undefined;

  return {
    base64Data: parsed.data.data,
    format: parsed.data.format,
    ...(parsed.data.width !== undefined ? { width: parsed.data.width } : {}),
    ...(parsed.data.height !== undefined ? { height: parsed.data.height } : {}),
  };
}
