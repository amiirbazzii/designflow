import type {
  FigmaAssetSnapshot,
  FigmaComponentSnapshot,
  FigmaNodeSnapshot,
  FigmaStyleSnapshot,
  FigmaVariableSnapshot,
} from "@designflow/sdk";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";

const BLOCKING_WARNING_CODES = new Set([
  "DESIGN_CONTEXT_RETRIEVAL_FAILED",
  "METADATA_OUTLINE_UNPARSED",
  "INSTANCE_EXPANSION_BOUNDED",
]);

export interface FreshBuilderNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentId?: string;
  readonly order: number;
  readonly visible?: boolean;
  readonly geometry?: {
    readonly absolute?: FigmaNodeSnapshot["absoluteBoundingBox"];
    readonly relative?: FigmaNodeSnapshot["relativeBoundingBox"];
  };
  readonly layout?: {
    readonly mode?: FigmaNodeSnapshot["layoutMode"];
    readonly itemSpacing?: number;
    readonly padding?: FigmaNodeSnapshot["padding"];
    readonly primaryAxisAlignItems?: string;
    readonly counterAxisAlignItems?: string;
    readonly sizingHorizontal?: string;
    readonly sizingVertical?: string;
    readonly constraints?: FigmaNodeSnapshot["constraints"];
  };
  readonly style?: {
    readonly fills?: readonly Record<string, unknown>[];
    readonly strokes?: readonly Record<string, unknown>[];
    readonly cornerRadius?: number;
    readonly opacity?: number;
    readonly textAlignHorizontal?: string;
    readonly typography?: Readonly<Record<string, unknown>>;
  };
  readonly text?: string;
  readonly component?: {
    readonly id?: string;
    readonly name: string;
    readonly variantProperties?: Readonly<Record<string, string>>;
  };
  readonly boundVariables?: Readonly<Record<string, unknown>>;
}

export interface FreshBuilderEvidence {
  readonly schemaVersion: "1";
  readonly frame: FreshFrameEvidence["frame"];
  readonly hierarchy: readonly FreshBuilderNode[];
  readonly components: readonly FigmaComponentSnapshot[];
  readonly variables: readonly FigmaVariableSnapshot[];
  readonly styles: readonly FigmaStyleSnapshot[];
  readonly assets: readonly FigmaAssetSnapshot[];
  readonly referenceScreenshot?: FreshFrameEvidence["referenceScreenshot"];
}

export interface FreshBuilderEvidenceCompleteness {
  readonly complete: boolean;
  readonly blockingWarnings: readonly string[];
  readonly unresolvedVisibleInstances: readonly {
    readonly id: string;
    readonly name: string;
    readonly parentId?: string;
  }[];
}

export interface FreshBuilderEvidenceMetrics {
  readonly authoritativeEvidenceBytes: number;
  readonly freshBuilderEvidenceBytes: number;
  readonly approximateBuilderInputBytes: number;
  readonly approximateBuilderInputTokens: number;
  readonly nodeCount: number;
  readonly visibleTextCount: number;
  readonly unresolvedVisibleInstanceCount: number;
}

export interface FreshBuilderEvidenceProjection {
  readonly evidence: FreshBuilderEvidence;
  readonly completeness: FreshBuilderEvidenceCompleteness;
  readonly metrics: FreshBuilderEvidenceMetrics;
}

export class FreshBuilderEvidenceIncompleteError extends Error {
  public readonly code = "ERR_FRESH_UI_EVIDENCE_INCOMPLETE";

  public constructor(
    message: string,
    public readonly completeness: FreshBuilderEvidenceCompleteness,
  ) {
    super(message);
    this.name = "FreshBuilderEvidenceIncompleteError";
    Object.setPrototypeOf(this, FreshBuilderEvidenceIncompleteError.prototype);
  }
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function typography(node: FigmaNodeSnapshot): Readonly<Record<string, unknown>> | undefined {
  const source = record(node.properties["typography"]);
  if (source === undefined) return undefined;
  const allowed = ["fontFamily", "fontStyle", "fontSize", "fontSizePx", "lineHeight", "lineHeightPx", "letterSpacing"];
  const selected = Object.fromEntries(allowed.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
  return Object.keys(selected).length > 0 ? selected : undefined;
}

function referencedStrings(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) referencedStrings(item, output);
    return;
  }
  const source = record(value);
  if (source === undefined) return;
  for (const item of Object.values(source)) referencedStrings(item, output);
}

function componentFor(
  node: FigmaNodeSnapshot,
  components: readonly FigmaComponentSnapshot[],
): FreshBuilderNode["component"] {
  if (node.type !== "INSTANCE" && node.componentId === undefined && node.variantProperties === undefined) return undefined;
  const matching = components.find((component) => component.id === node.componentId || component.id === node.id);
  return {
    ...(node.componentId === undefined ? {} : { id: node.componentId }),
    name: matching?.name ?? node.name,
    ...(node.variantProperties === undefined ? {} : { variantProperties: node.variantProperties }),
  };
}

function projectNode(
  node: FigmaNodeSnapshot,
  originalIndex: number,
  byId: ReadonlyMap<string, FigmaNodeSnapshot>,
  components: readonly FigmaComponentSnapshot[],
): FreshBuilderNode {
  const parent = node.parentId === undefined ? undefined : byId.get(node.parentId);
  const parentOrder = parent?.childIds.indexOf(node.id) ?? -1;
  const nodeTypography = typography(node);
  const nodeComponent = componentFor(node, components);
  const geometry = node.absoluteBoundingBox === undefined && node.relativeBoundingBox === undefined
    ? undefined
    : {
        ...(node.absoluteBoundingBox === undefined ? {} : { absolute: node.absoluteBoundingBox }),
        ...(node.relativeBoundingBox === undefined ? {} : { relative: node.relativeBoundingBox }),
      };
  const layout = node.layoutMode === undefined
    && node.itemSpacing === undefined
    && node.padding === undefined
    && node.primaryAxisAlignItems === undefined
    && node.counterAxisAlignItems === undefined
    && node.sizingHorizontal === undefined
    && node.sizingVertical === undefined
    && node.constraints === undefined
    ? undefined
    : {
        ...(node.layoutMode === undefined ? {} : { mode: node.layoutMode }),
        ...(node.itemSpacing === undefined ? {} : { itemSpacing: node.itemSpacing }),
        ...(node.padding === undefined ? {} : { padding: node.padding }),
        ...(node.primaryAxisAlignItems === undefined ? {} : { primaryAxisAlignItems: node.primaryAxisAlignItems }),
        ...(node.counterAxisAlignItems === undefined ? {} : { counterAxisAlignItems: node.counterAxisAlignItems }),
        ...(node.sizingHorizontal === undefined ? {} : { sizingHorizontal: node.sizingHorizontal }),
        ...(node.sizingVertical === undefined ? {} : { sizingVertical: node.sizingVertical }),
        ...(node.constraints === undefined ? {} : { constraints: node.constraints }),
      };
  const style = node.fills.length === 0
    && node.strokes.length === 0
    && node.cornerRadius === undefined
    && node.opacity === undefined
    && node.textAlignHorizontal === undefined
    && nodeTypography === undefined
    ? undefined
    : {
        ...(node.fills.length === 0 ? {} : { fills: node.fills }),
        ...(node.strokes.length === 0 ? {} : { strokes: node.strokes }),
        ...(node.cornerRadius === undefined ? {} : { cornerRadius: node.cornerRadius }),
        ...(node.opacity === undefined ? {} : { opacity: node.opacity }),
        ...(node.textAlignHorizontal === undefined ? {} : { textAlignHorizontal: node.textAlignHorizontal }),
        ...(nodeTypography === undefined ? {} : { typography: nodeTypography }),
      };
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
    order: parentOrder >= 0 ? parentOrder : originalIndex,
    ...(node.visible === undefined ? {} : { visible: node.visible }),
    ...(geometry === undefined ? {} : { geometry }),
    ...(layout === undefined ? {} : { layout }),
    ...(style === undefined ? {} : { style }),
    ...(node.characters === undefined || node.characters.trim().length === 0 ? {} : { text: node.characters }),
    ...(nodeComponent === undefined ? {} : { component: nodeComponent }),
    ...(node.boundVariables === undefined ? {} : { boundVariables: node.boundVariables }),
  };
}

function unresolvedVisibleInstances(nodes: readonly FigmaNodeSnapshot[]): FreshBuilderEvidenceCompleteness["unresolvedVisibleInstances"] {
  return nodes
    .filter((node) => node.visible !== false && node.type === "INSTANCE" && node.childIds.length === 0)
    .map((node) => ({ id: node.id, name: node.name, ...(node.parentId === undefined ? {} : { parentId: node.parentId }) }));
}

function frameNodeIds(nodes: readonly FigmaNodeSnapshot[], rootId: string): ReadonlySet<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === undefined) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parentId, children);
  }
  const included = new Set<string>();
  const visit = (id: string): void => {
    if (included.has(id)) return;
    const node = byId.get(id);
    if (node === undefined) return;
    included.add(id);
    const orderedChildren = [
      ...node.childIds,
      ...(childrenByParent.get(id) ?? []).filter((childId) => !node.childIds.includes(childId)),
    ];
    for (const childId of orderedChildren) visit(childId);
  };
  visit(rootId);
  return included;
}

export function createFreshBuilderEvidence(evidence: FreshFrameEvidence): FreshBuilderEvidenceProjection {
  const snapshot = evidence.snapshot;
  const blockingWarnings = snapshot.warnings
    .filter((warning) => BLOCKING_WARNING_CODES.has(warning.code))
    .map((warning) => warning.code);
  const root = snapshot.nodes.find((node) => node.id === evidence.frame.id);
  const scopedIds = root === undefined ? new Set<string>() : frameNodeIds(snapshot.nodes, evidence.frame.id);
  const scopedNodes = snapshot.nodes.filter((node) => scopedIds.has(node.id));
  const visibleNodes = scopedNodes.filter((node) => node.visible !== false);
  if (root === undefined) blockingWarnings.push("FRAME_HIERARCHY_MISSING");
  if (visibleNodes.length === 0) blockingWarnings.push("VISIBLE_HIERARCHY_EMPTY");

  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const unresolved = unresolvedVisibleInstances(scopedNodes);
  const projectedNodes = visibleNodes.map((node, index) => projectNode(node, index, byId, snapshot.components));
  const instanceIds = new Set(scopedNodes.filter((node) => node.type === "INSTANCE").map((node) => node.id));
  const componentIds = new Set(scopedNodes.flatMap((node) => node.componentId === undefined ? [] : [node.componentId]));
  const components = snapshot.components.filter((component) => instanceIds.has(component.id) || componentIds.has(component.id));
  const variableRefs = new Set<string>();
  for (const node of scopedNodes) referencedStrings(node.boundVariables, variableRefs);
  const variables = snapshot.variables.filter((variable) => variableRefs.has(variable.name));
  const referencedResourceIds = new Set<string>();
  for (const node of scopedNodes) {
    referencedStrings(node.properties, referencedResourceIds);
    referencedStrings(node.exportSettings, referencedResourceIds);
  }
  const styles = snapshot.styles.filter((style) => referencedResourceIds.has(style.id));
  const assets = snapshot.assets.filter((asset) => referencedResourceIds.has(asset.id) || (asset.reference !== undefined && referencedResourceIds.has(asset.reference)));
  const builderEvidence: FreshBuilderEvidence = {
    schemaVersion: "1",
    frame: evidence.frame,
    hierarchy: projectedNodes,
    components,
    variables,
    styles,
    assets,
    ...(evidence.referenceScreenshot === undefined ? {} : { referenceScreenshot: evidence.referenceScreenshot }),
  };
  const completeness: FreshBuilderEvidenceCompleteness = {
    complete: blockingWarnings.length === 0 && unresolved.length === 0,
    blockingWarnings: [...new Set(blockingWarnings)],
    unresolvedVisibleInstances: unresolved,
  };
  if (!completeness.complete) {
    throw new FreshBuilderEvidenceIncompleteError(
      "Fresh UI evidence is incomplete; the Builder was not invoked.",
      completeness,
    );
  }
  const freshBuilderEvidenceBytes = bytes(builderEvidence);
  const approximateBuilderInputBytes = bytes({
    evidence: builderEvidence,
    frame: evidence.frame,
    fixedStack: ["Vite", "React", "TypeScript", "Plain CSS"],
    allowedWritePaths: ["src/App.tsx", "src/styles.css", "src/assets/**"],
    mode: "generate",
    attempt: 1,
  });
  return {
    evidence: builderEvidence,
    completeness,
    metrics: {
      authoritativeEvidenceBytes: bytes(evidence),
      freshBuilderEvidenceBytes,
      approximateBuilderInputBytes,
      approximateBuilderInputTokens: Math.ceil(approximateBuilderInputBytes / 4),
      nodeCount: projectedNodes.length,
      visibleTextCount: projectedNodes.filter((node) => node.text !== undefined).length,
      unresolvedVisibleInstanceCount: unresolved.length,
    },
  };
}
