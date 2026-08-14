// packages/agents/src/visual-validation/visual-expectation-compiler.ts
//
// Blueprint → checkable visual expectations (V2, V2-5 / hardened in V2-5.1).
//
// Nothing here calls a model. The Blueprint's `facts` are already the design's
// deterministic truth — an exact string, a width in pixels, a hex color — so
// turning them into things a browser can be asked about is arithmetic, not
// judgment.
//
// V2-5 emitted expectations only for elements carrying visible copy, because
// copy was the only way to find the element again. That left the parts of a
// screen a person notices first — the bottom navigation, the back icon, the
// card surface — entirely unchecked. V2-5.1 removes that restriction: every
// expectation now carries an `anchor` describing how the host will identify
// its element, and identification is a separate deterministic step with its
// own uncertainty (see `element-correspondence.ts`).
import type {
  ExpectationAnchor,
  ImplementationMap,
  UIBlueprint,
  VisualExpectation,
} from "@designflow/sdk";

export interface CompiledExpectations {
  readonly expectations: readonly VisualExpectation[];
  /** Elements with design facts that no deterministic signal could anchor. */
  readonly unanchorableElementCount: number;
  readonly bounds: readonly { collection: string; originalCount: number; retainedCount: number; reason: string }[];
}

/** The contract's ceiling; beyond this the report stops being readable anyway. */
const MAX_EXPECTATIONS = 200;

/** Text is compared as a human reads it, not as the DOM serializes it. */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The marker the isolated render writes for one mapped requirement.
 *
 * Shared by the compiler and the renderer so the value the host injects and
 * the value the host looks for cannot drift apart.
 */
export function instrumentationRefFor(requirementId: string): string {
  return requirementId.replace(/[^A-Za-z0-9:_-]/g, "-").slice(0, 200);
}

function geometryTolerance(px: number): number {
  // Fonts, borders and subpixel layout move real implementations a little.
  // 4px or 5%, whichever is larger, keeps honest rendering out of the report.
  return Math.max(4, px * 0.05);
}

/** Figma node types → the tags a faithful implementation would plausibly use. */
function tagHintsFor(nodeType: string | undefined, hasText: boolean): readonly string[] {
  switch ((nodeType ?? "").toUpperCase()) {
    case "TEXT":
      return ["p", "span", "h1", "h2", "h3", "h4", "label", "div", "a", "button"];
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "STAR":
    case "ELLIPSE":
      return ["svg", "img", "i", "span"];
    case "RECTANGLE":
      return ["div", "img", "section"];
    case "FRAME":
    case "GROUP":
    case "COMPONENT":
    case "INSTANCE":
      // `main` included deliberately: a faithful screen implementation very
      // often *is* `<main>`, and a hint list that excludes it structurally
      // filters out the screen's own wrapper before content can identify it.
      return hasText
        ? ["div", "main", "section", "nav", "header", "footer", "article", "ul", "form"]
        : ["div", "main", "section", "nav", "header", "footer", "article", "ul", "svg", "img"];
    default:
      return [];
  }
}

interface MapIndex {
  /** blueprint component id → { requirementId, componentName } */
  readonly components: ReadonlyMap<string, { requirementId: string; componentName?: string }>;
  readonly assets: ReadonlyMap<string, { requirementId: string; projectAssetPath?: string }>;
}

function indexMap(map: ImplementationMap | undefined): MapIndex {
  const components = new Map<string, { requirementId: string; componentName?: string }>();
  const assets = new Map<string, { requirementId: string; projectAssetPath?: string }>();
  if (map === undefined) return { components, assets };

  for (const component of map.components) {
    const path = component.projectTarget?.path ?? component.plannedPath;
    const componentName = path === undefined ? undefined : (path.split("/").at(-1) ?? "").replace(/\.[^.]+$/, "");
    components.set(component.blueprintComponentId, {
      requirementId: component.requirementId,
      ...(componentName !== undefined && componentName.length > 0 ? { componentName } : {}),
    });
  }
  for (const asset of map.assets)
    assets.set(asset.blueprintAssetId, {
      requirementId: asset.requirementId,
      ...(asset.projectAssetPath !== undefined ? { projectAssetPath: asset.projectAssetPath } : {}),
    });

  return { components, assets };
}

export function compileVisualExpectations(
  blueprint: UIBlueprint,
  map?: ImplementationMap,
): CompiledExpectations {
  const expectations: VisualExpectation[] = [];
  const index = indexMap(map);
  let unanchorable = 0;

  const childrenOf = new Map<string, string[]>();
  for (const element of blueprint.elements) {
    if (element.parentId === undefined) continue;
    const bucket = childrenOf.get(element.parentId);
    if (bucket === undefined) childrenOf.set(element.parentId, [element.id]);
    else bucket.push(element.id);
  }
  const elementById = new Map(blueprint.elements.map((element) => [element.id, element]));

  /** Every exact string this element renders, itself and below. */
  function containedText(id: string, depth = 0): readonly string[] {
    if (depth > 6) return [];
    const element = elementById.get(id);
    if (element === undefined) return [];
    const own = element.facts.text?.trim();
    return [
      ...(own !== undefined && own.length > 0 ? [own.slice(0, 200)] : []),
      ...(childrenOf.get(id) ?? []).flatMap((child) => containedText(child, depth + 1)),
    ].slice(0, 16);
  }

  for (const element of blueprint.elements) {
    const { facts, semantics } = element;
    const text = facts.text?.trim();
    // A map decision names a Blueprint *component* when the design used one,
    // and the element itself when the design drew the thing inline. Both are
    // the same claim — "this requirement is realized here" — so both resolve.
    const mapped =
      (facts.componentRef === undefined ? undefined : index.components.get(facts.componentRef)) ??
      index.components.get(element.id);
    const mappedAsset = facts.assetRef === undefined ? undefined : index.assets.get(facts.assetRef);
    const contained = text === undefined || text.length === 0 ? containedText(element.id) : [];

    const elementKind: ExpectationAnchor["elementKind"] =
      text !== undefined && text.length > 0
        ? "text"
        : mappedAsset !== undefined || facts.assetRef !== undefined
          ? "asset"
          : mapped !== undefined || facts.componentRef !== undefined
            ? "component"
            : "container";

    const anchor: ExpectationAnchor = {
      elementKind,
      ...(mapped !== undefined ? { instrumentationRef: instrumentationRefFor(mapped.requirementId) } : {}),
      ...(mappedAsset !== undefined ? { instrumentationRef: instrumentationRefFor(mappedAsset.requirementId) } : {}),
      ...(mapped?.componentName !== undefined ? { mappedComponentName: mapped.componentName } : {}),
      ...(text !== undefined && text.length > 0 ? { text: text.slice(0, 400) } : {}),
      tagHints: [...tagHintsFor(facts.nodeType, text !== undefined && text.length > 0)],
      order: element.order,
      containedText: [...contained],
    };

    // Nothing deterministic could ever find this node again. Counted, never
    // turned into an expectation that would resolve to whatever happened to
    // be nearby.
    const anchorable =
      anchor.instrumentationRef !== undefined ||
      anchor.mappedComponentName !== undefined ||
      anchor.text !== undefined ||
      anchor.containedText.length > 0 ||
      (anchor.tagHints.length > 0 && elementKind === "asset");

    if (!anchorable) {
      if (facts.widthPx !== undefined || facts.style?.background !== undefined) unanchorable += 1;
      continue;
    }

    const label = facts.name ?? text?.slice(0, 60) ?? element.id;
    // Copy the user reads is the design. Primary copy missing is not a
    // near-miss, it is the wrong screen.
    const missingSeverity = semantics.importance === "primary" ? "critical" : "major";

    // Presence is the first question for every element, with or without copy.
    expectations.push({
      id: `expectation:${element.id}:presence`,
      kind: elementKind === "text" ? "content" : "structure",
      blueprintRef: element.id,
      label,
      property: elementKind === "text" ? "text" : "presence",
      expected: text !== undefined && text.length > 0 ? text.slice(0, 400) : `${label} is rendered`,
      severityIfMissing: elementKind === "text" ? missingSeverity : "major",
      anchor,
    });

    if (facts.heightPx !== undefined && facts.heightPx > 0)
      expectations.push({
        id: `expectation:${element.id}:height`,
        kind: "geometry",
        blueprintRef: element.id,
        label,
        property: "height",
        expected: `${facts.heightPx}px`,
        expectedNumber: facts.heightPx,
        tolerance: geometryTolerance(facts.heightPx),
        severityIfMissing: "minor",
        anchor,
      });

    if (facts.widthPx !== undefined && facts.widthPx > 0 && elementKind !== "text")
      expectations.push({
        id: `expectation:${element.id}:width`,
        kind: "geometry",
        blueprintRef: element.id,
        label,
        property: "width",
        expected: `${facts.widthPx}px`,
        expectedNumber: facts.widthPx,
        tolerance: geometryTolerance(facts.widthPx),
        severityIfMissing: "minor",
        anchor,
      });

    if (facts.typography?.fontSizePx !== undefined && facts.typography.fontSizePx > 0)
      expectations.push({
        id: `expectation:${element.id}:font-size`,
        kind: "typography",
        blueprintRef: element.id,
        label,
        property: "fontSize",
        expected: `${facts.typography.fontSizePx}px`,
        expectedNumber: facts.typography.fontSizePx,
        tolerance: 1,
        severityIfMissing: "minor",
        anchor,
      });

    if (facts.textColor !== undefined)
      expectations.push({
        id: `expectation:${element.id}:color`,
        kind: "surface",
        blueprintRef: element.id,
        label,
        property: "color",
        expected: facts.textColor,
        severityIfMissing: "minor",
        anchor,
      });

    if (facts.style?.background !== undefined)
      expectations.push({
        id: `expectation:${element.id}:background`,
        kind: "surface",
        blueprintRef: element.id,
        label,
        property: "backgroundColor",
        expected: facts.style.background,
        severityIfMissing: "minor",
        anchor,
      });

    if (facts.style?.radiusPx !== undefined && facts.style.radiusPx > 0)
      expectations.push({
        id: `expectation:${element.id}:radius`,
        kind: "surface",
        blueprintRef: element.id,
        label,
        property: "borderRadius",
        expected: `${facts.style.radiusPx}px`,
        expectedNumber: facts.style.radiusPx,
        tolerance: 2,
        severityIfMissing: "minor",
        anchor,
      });
  }

  // Mapped components the design uses but no single element carries copy for —
  // a bottom navigation or an icon button must still be *there*.
  for (const component of blueprint.components) {
    const mapped = index.components.get(component.id);
    if (mapped === undefined) continue;
    const instanceElementIds = new Set(component.instances.map((instance) => instance.elementId));
    if ([...instanceElementIds].some((id) => elementById.get(id)?.facts.text !== undefined)) continue;

    expectations.push({
      id: `expectation:${component.id}:presence`,
      kind: "structure",
      blueprintRef: component.id,
      label: component.name,
      property: "presence",
      expected: `${component.name} is rendered`,
      severityIfMissing: "major",
      anchor: {
        elementKind: "component",
        instrumentationRef: instrumentationRefFor(mapped.requirementId),
        ...(mapped.componentName !== undefined ? { mappedComponentName: mapped.componentName } : {}),
        tagHints: ["nav", "div", "section", "ul", "button", "footer", "header"],
        containedText: component.instances
          .flatMap((instance) => instance.contents.map((content) => content.text))
          .filter((value): value is string => value !== undefined && value.trim().length > 0)
          .map((value) => value.trim().slice(0, 200))
          .slice(0, 16),
      },
    });
  }

  // A style the map deliberately kept as a raw design value has no token to
  // hide behind: it must appear on screen exactly as the design stated it.
  for (const style of map?.styles ?? []) {
    if (style.strategy !== "raw_design_value" || style.category !== "color") continue;
    expectations.push({
      id: `expectation:style:${style.designValue}`,
      kind: "surface",
      blueprintRef: `style:${style.designValue}`,
      label: `raw design color ${style.designValue}`,
      property: "anyColor",
      expected: style.designValue,
      severityIfMissing: "minor",
      anchor: { elementKind: "container", tagHints: [], containedText: [] },
    });
  }

  const bounds: { collection: string; originalCount: number; retainedCount: number; reason: string }[] = [];
  if (expectations.length > MAX_EXPECTATIONS)
    bounds.push({
      collection: "expectations",
      originalCount: expectations.length,
      retainedCount: MAX_EXPECTATIONS,
      reason: "Expectation ceiling reached; presence expectations are retained first.",
    });

  // Presence first, so a truncated run still checks whether the right screen
  // was built before it checks whether its corners are round enough.
  const rank = (expectation: VisualExpectation): number =>
    expectation.property === "text" ? 0 : expectation.property === "presence" ? 1 : 2;
  const ordered = [...expectations].sort((left, right) => rank(left) - rank(right));

  return {
    expectations: ordered.slice(0, MAX_EXPECTATIONS),
    unanchorableElementCount: unanchorable,
    bounds,
  };
}
