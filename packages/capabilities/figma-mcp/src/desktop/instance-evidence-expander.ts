// packages/capabilities/figma-mcp/src/desktop/instance-evidence-expander.ts
import type { FigmaNodeSnapshot, FigmaSnapshotWarning } from "@designflow/sdk";
import type { DesignContextTreeNode } from "../desktop/desktop-design-context-parser";

// ── Instance descendant expansion (DF-SPEC-04) ───────────────────
//
// The `get_metadata` outline stops at INSTANCE boundaries, but the
// `get_design_context` code exposes the full generated subtree — visible
// text, icon slots, dimensions and styling INSIDE component instances, plus
// the component's generated name and instance property values on
// capitalized tags. This pass materializes those descendants as real
// snapshot nodes under their instance, bounded structurally: only subtrees
// rooted at nodes the outline already contains, a fixed depth, and a fixed
// total node budget. Nothing is invented; every fact comes from the closed
// generated grammar.
const MAX_EXPANDED_NODES = 400;
const MAX_EXPANSION_DEPTH = 8;

interface InstanceExpansion {
  readonly nodes: FigmaNodeSnapshot[];
  readonly componentNames: ReadonlyMap<string, string>;
}

function contextNodeToSnapshot(
  ctx: DesignContextTreeNode,
  parentId: string,
): FigmaNodeSnapshot {
  const fills: Record<string, unknown>[] = [];
  if (ctx.facts.backgroundColor !== undefined) fills.push({ type: "SOLID", color: ctx.facts.backgroundColor });
  if (ctx.text !== undefined && ctx.facts.textColor !== undefined) fills.push({ type: "SOLID", color: ctx.facts.textColor });
  const strokes: Record<string, unknown>[] = [];
  if (ctx.facts.borderColor !== undefined) strokes.push({ type: "SOLID", color: ctx.facts.borderColor });

  const typography: Record<string, unknown> = {};
  if (ctx.facts.fontFamily !== undefined) typography.fontFamily = ctx.facts.fontFamily;
  if (ctx.facts.fontStyle !== undefined) typography.fontStyle = ctx.facts.fontStyle;
  if (ctx.facts.fontSizePx !== undefined) typography.fontSize = ctx.facts.fontSizePx;

  const geometry: Record<string, unknown> = {};
  if (ctx.widthPx !== undefined) geometry.widthPx = ctx.widthPx;
  if (ctx.heightPx !== undefined) geometry.heightPx = ctx.heightPx;
  if (ctx.paddingXPx !== undefined) geometry.paddingXPx = ctx.paddingXPx;
  if (ctx.paddingYPx !== undefined) geometry.paddingYPx = ctx.paddingYPx;

  return {
    id: ctx.nodeId,
    name: ctx.name ?? ctx.componentName ?? (ctx.text !== undefined ? ctx.text.slice(0, 40) : ctx.tag),
    type: ctx.text !== undefined ? "TEXT" : ctx.componentName !== undefined ? "INSTANCE" : "FRAME",
    parentId,
    childIds: [],
    ...(ctx.facts.layoutMode !== undefined ? { layoutMode: ctx.facts.layoutMode } : {}),
    ...(ctx.facts.itemSpacing !== undefined ? { itemSpacing: ctx.facts.itemSpacing } : {}),
    ...(ctx.facts.cornerRadius !== undefined ? { cornerRadius: ctx.facts.cornerRadius } : {}),
    ...(ctx.facts.opacity !== undefined ? { opacity: ctx.facts.opacity } : {}),
    fills,
    strokes,
    effects: [],
    ...(ctx.text !== undefined ? { characters: ctx.text } : {}),
    ...(ctx.propertyValues !== undefined ? { variantProperties: ctx.propertyValues } : {}),
    exportSettings: [],
    interactions: [],
    properties: {
      ...(Object.keys(typography).length > 0 ? { typography } : {}),
      ...(Object.keys(geometry).length > 0 ? { context: geometry } : {}),
      ...(ctx.componentName !== undefined ? { componentName: ctx.componentName } : {}),
    },
  };
}

export function expandInstanceEvidence(
  nodes: readonly FigmaNodeSnapshot[],
  contextTree: readonly DesignContextTreeNode[],
  warnings: FigmaSnapshotWarning[],
): InstanceExpansion {
  if (contextTree.length === 0) return { nodes: [...nodes], componentNames: new Map() };

  const byId = new Map(nodes.map((node) => [node.id, { ...node, childIds: [...node.childIds] }]));
  const added: FigmaNodeSnapshot[] = [];
  const componentNames = new Map<string, string>();
  let budget = MAX_EXPANDED_NODES;
  let truncated = false;

  const walk = (ctx: DesignContextTreeNode, parentKnownId: string | undefined, depth: number): void => {
    const known = byId.get(ctx.nodeId);
    if (known !== undefined) {
      // Upgrade an outline node in place with context evidence it lacked.
      if (ctx.componentName !== undefined) componentNames.set(known.id, ctx.componentName);
      if (ctx.propertyValues !== undefined && known.variantProperties === undefined) {
        known.variantProperties = { ...ctx.propertyValues };
      }
      if (ctx.text !== undefined && known.characters === undefined) known.characters = ctx.text;
      for (const child of ctx.children) walk(child, known.id, 0);
      return;
    }

    if (parentKnownId === undefined) {
      // Not anchored under any outline node yet; descend until we find one.
      for (const child of ctx.children) walk(child, undefined, 0);
      return;
    }

    if (budget <= 0 || depth >= MAX_EXPANSION_DEPTH) {
      truncated = true;
      return;
    }
    budget -= 1;

    const snapshot = contextNodeToSnapshot(ctx, parentKnownId);
    added.push(snapshot);
    byId.set(snapshot.id, snapshot as never);
    const parent = byId.get(parentKnownId);
    if (parent !== undefined && !parent.childIds.includes(snapshot.id)) parent.childIds.push(snapshot.id);
    if (ctx.componentName !== undefined) componentNames.set(snapshot.id, ctx.componentName);
    for (const child of ctx.children) walk(child, snapshot.id, depth + 1);
  };

  for (const root of contextTree) walk(root, undefined, 0);

  if (truncated) {
    warnings.push({
      code: "INSTANCE_EXPANSION_BOUNDED",
      message: `Instance descendant expansion stopped at the structural bound (${MAX_EXPANDED_NODES} nodes / depth ${MAX_EXPANSION_DEPTH}); deeper evidence was not captured`,
    });
  }

  const ordered: FigmaNodeSnapshot[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const updated = byId.get(node.id);
    if (updated !== undefined && !seen.has(node.id)) { ordered.push(updated); seen.add(node.id); }
  }
  for (const node of added) {
    const updated = byId.get(node.id);
    if (updated !== undefined && !seen.has(node.id)) { ordered.push(updated); seen.add(node.id); }
  }
  return { nodes: ordered, componentNames };
}
