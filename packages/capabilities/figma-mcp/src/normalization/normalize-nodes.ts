// packages/capabilities/figma-mcp/src/normalize-nodes.ts
import { z } from "zod";
import type { FigmaNodeSnapshot, FigmaSnapshotWarning } from "@designflow/sdk";

/**
 * Normalizes an MCP server's raw node tree into DesignFlow's flat
 * `FigmaNodeSnapshot[]`.
 *
 * Loosely modeled on the shape Figma's own REST API (and, in practice, most
 * MCP servers that proxy it) returns for a node — but every field beyond
 * `id`/`name`/`type` is read defensively with `safeParse`/optional access,
 * never assumed present. A field this schema does not explicitly recognise
 * is preserved verbatim under `properties`, never dropped and never
 * fabricated into one of the named fields.
 */

const RECOGNISED_KEYS = new Set([
  "id",
  "name",
  "type",
  "visible",
  "children",
  "absoluteBoundingBox",
  "relativeBoundingBox" ,
  "layoutMode",
  "itemSpacing",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "constraints",
  "cornerRadius",
  "opacity",
  "fills",
  "strokes",
  "effects",
  "characters",
  "style",
  "componentId",
  "componentProperties",
  "exportSettings",
  "boundVariables",
  "reactions",
]);

const boundingBoxLike = z
  .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
  .partial()
  .passthrough();

const rawNodeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      type: z.string().min(1),
    })
    .passthrough(),
);

export interface NormalizedNodes {
  readonly nodes: readonly FigmaNodeSnapshot[];
  readonly warnings: readonly FigmaSnapshotWarning[];
}

/** Recursively flattens a raw node tree (as returned by an MCP server) into a flat, parent-linked list. */
export function normalizeFigmaNodeTree(root: unknown): NormalizedNodes {
  const nodes: FigmaNodeSnapshot[] = [];
  const warnings: FigmaSnapshotWarning[] = [];

  walk(root, undefined, nodes, warnings);

  return { nodes, warnings };
}

function walk(
  raw: unknown,
  parentId: string | undefined,
  nodes: FigmaNodeSnapshot[],
  warnings: FigmaSnapshotWarning[],
): void {
  const parsed = rawNodeSchema.safeParse(raw);
  if (!parsed.success) {
    warnings.push({
      code: "NODE_SHAPE_UNRECOGNIZED",
      message: "A node in the source tree did not carry an id/name/type and was skipped",
    });
    return;
  }

  const node = parsed.data;
  const childrenRaw = Array.isArray(node.children) ? node.children : [];
  const childIds = childrenRaw
    .map((child) => (typeof child === "object" && child !== null ? (child as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const bounds = boundingBoxLike.safeParse(node.absoluteBoundingBox);
  const style = z.record(z.unknown()).safeParse(node.style);

  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!RECOGNISED_KEYS.has(key)) properties[key] = value;
  }

  const snapshot: FigmaNodeSnapshot = {
    id: node.id as string,
    name: node.name as string,
    type: node.type as string,
    ...(parentId !== undefined ? { parentId } : {}),
    childIds,
    ...(typeof node.visible === "boolean" ? { visible: node.visible } : {}),
    ...(bounds.success ? { absoluteBoundingBox: bounds.data as never } : {}),
    ...(isLayoutMode(node.layoutMode) ? { layoutMode: node.layoutMode } : {}),
    ...(typeof node.itemSpacing === "number" ? { itemSpacing: node.itemSpacing } : {}),
    ...(hasPadding(node)
      ? {
          padding: {
            top: numberOr0(node.paddingTop),
            right: numberOr0(node.paddingRight),
            bottom: numberOr0(node.paddingBottom),
            left: numberOr0(node.paddingLeft),
          },
        }
      : {}),
    ...(typeof node.primaryAxisAlignItems === "string"
      ? { primaryAxisAlignItems: node.primaryAxisAlignItems }
      : {}),
    ...(typeof node.counterAxisAlignItems === "string"
      ? { counterAxisAlignItems: node.counterAxisAlignItems }
      : {}),
    ...(typeof node.layoutSizingHorizontal === "string"
      ? { sizingHorizontal: node.layoutSizingHorizontal }
      : {}),
    ...(typeof node.layoutSizingVertical === "string"
      ? { sizingVertical: node.layoutSizingVertical }
      : {}),
    ...(isConstraints(node.constraints) ? { constraints: node.constraints } : {}),
    ...(typeof node.cornerRadius === "number" ? { cornerRadius: node.cornerRadius } : {}),
    ...(typeof node.opacity === "number" ? { opacity: node.opacity } : {}),
    fills: Array.isArray(node.fills) ? node.fills.filter(isRecord) : [],
    strokes: Array.isArray(node.strokes) ? node.strokes.filter(isRecord) : [],
    effects: Array.isArray(node.effects) ? node.effects.filter(isRecord) : [],
    exportSettings: Array.isArray(node.exportSettings) ? node.exportSettings.filter(isRecord) : [],
    interactions: Array.isArray(node.reactions) ? node.reactions.filter(isRecord) : [],
    ...(typeof node.characters === "string" ? { characters: node.characters } : {}),
    ...(style.success && typeof style.data.textAlignHorizontal === "string"
      ? { textAlignHorizontal: style.data.textAlignHorizontal }
      : {}),
    ...(typeof node.componentId === "string" ? { componentId: node.componentId } : {}),
    ...(isStringRecord(node.componentProperties) ? { variantProperties: node.componentProperties } : {}),
    ...(isRecord(node.boundVariables) ? { boundVariables: node.boundVariables } : {}),
    properties,
  };

  nodes.push(snapshot);

  for (const child of childrenRaw) {
    walk(child, snapshot.id, nodes, warnings);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
}

function isLayoutMode(value: unknown): value is "NONE" | "HORIZONTAL" | "VERTICAL" {
  return value === "NONE" || value === "HORIZONTAL" || value === "VERTICAL";
}

function isConstraints(value: unknown): value is { horizontal: string; vertical: string } {
  return isRecord(value) && typeof value.horizontal === "string" && typeof value.vertical === "string";
}

function hasPadding(node: Record<string, unknown>): boolean {
  return (
    typeof node.paddingTop === "number" ||
    typeof node.paddingRight === "number" ||
    typeof node.paddingBottom === "number" ||
    typeof node.paddingLeft === "number"
  );
}

function numberOr0(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
