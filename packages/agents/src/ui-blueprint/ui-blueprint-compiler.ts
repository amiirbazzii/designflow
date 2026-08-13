// packages/agents/src/ui-blueprint/ui-blueprint-compiler.ts
//
// The deterministic Blueprint compiler (Agent Architecture V2, phase V2-1).
//
//   FigmaSourceSnapshot          persisted source evidence
//        ↓  compileSpecificationEvidenceBundle
//   SpecificationEvidenceBundle  compact normalized representation
//        ↓  compileUIBlueprintDraft  ← this file
//   UIBlueprint (draft)          the canonical product design contract
//
// Three representations, deliberately not merged: the snapshot is what the
// transport gave us and must stay auditable; the bundle is the compact form a
// compiler or a model can read without drowning in empty transport bags; the
// Blueprint is the contract the rest of the product speaks.
//
// Everything this file produces is a *fact* — compiled from evidence with no
// judgment, no inference and no model. The `semantics` on every entity are
// left empty for the Design Interpreter to fill through a validated patch.
// A draft with no semantics is already a valid, usable Blueprint.
import {
  uiBlueprintSchema,
  UI_BLUEPRINT_SCHEMA_VERSION,
  type BlueprintBound,
  type BlueprintComponent,
  type BlueprintElement,
  type BlueprintLayout,
  type BlueprintStyle,
  type BlueprintTypography,
  type FigmaSourceSnapshot,
  type UIBlueprint,
} from "@designflow/sdk";

import {
  compileSpecificationEvidenceBundle,
  type EvidenceElement,
  type EvidenceStyle,
  type SpecificationEvidenceBundle,
} from "../specification/evidence/specification-evidence-bundle";

export const UI_BLUEPRINT_COMPILER_VERSION = "1";

const EMPTY_SEMANTICS = { notes: [] as string[] } as const;

/** Bounds mirror the schema's own maxima; anything dropped is recorded. */
const MAX_ELEMENTS = 2000;
const MAX_COMPONENTS = 128;
const MAX_ASSETS = 128;
const MAX_INTERACTIONS = 128;

export interface CompileUIBlueprintOptions {
  /** The persisted evidence artifact this Blueprint is compiled from. */
  readonly snapshotArtifactId?: string;
}

/** `"392x56"` → `{ widthPx: 392, heightPx: 56 }`. Bundle sizes are exact. */
function parseSize(size: string | undefined): { widthPx?: number; heightPx?: number } {
  if (size === undefined) return {};
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(size);
  if (match === null) return {};
  return { widthPx: Number(match[1]), heightPx: Number(match[2]) };
}

/**
 * Reads the bundle's packed layout string back into typed fields.
 *
 * The bundle packs layout as `"vertical gap 16 padding 16/16/16/16 main center"`
 * for compactness in a model request. The Blueprint is a machine contract
 * rather than a prompt, so it carries the same facts as numbers a consumer can
 * compare without parsing prose.
 */
function parseLayout(layout: string | undefined): BlueprintLayout | undefined {
  if (layout === undefined || layout.trim().length === 0) return undefined;
  const result: {
    direction?: "horizontal" | "vertical";
    gapPx?: number;
    paddingTopPx?: number;
    paddingRightPx?: number;
    paddingBottomPx?: number;
    paddingLeftPx?: number;
    mainAxisAlign?: string;
    crossAxisAlign?: string;
    sizingHorizontal?: string;
    sizingVertical?: string;
  } = {};

  if (/\bhorizontal\b/.test(layout)) result.direction = "horizontal";
  else if (/\bvertical\b/.test(layout)) result.direction = "vertical";

  const gap = /\bgap (\d+(?:\.\d+)?)/.exec(layout);
  if (gap !== null) result.gapPx = Number(gap[1]);

  const padding4 = /\bpadding (\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/.exec(layout);
  if (padding4 !== null) {
    result.paddingTopPx = Number(padding4[1]);
    result.paddingRightPx = Number(padding4[2]);
    result.paddingBottomPx = Number(padding4[3]);
    result.paddingLeftPx = Number(padding4[4]);
  } else {
    // The two-value form the desktop adapter emits: vertical/horizontal.
    const padding2 = /\bpadding (\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)(?!\/)/.exec(layout);
    if (padding2 !== null) {
      result.paddingTopPx = Number(padding2[1]);
      result.paddingBottomPx = Number(padding2[1]);
      result.paddingRightPx = Number(padding2[2]);
      result.paddingLeftPx = Number(padding2[2]);
    }
  }

  const main = /\bmain ([a-z-]+)/.exec(layout);
  if (main?.[1] !== undefined) result.mainAxisAlign = main[1];
  const cross = /\bcross ([a-z-]+)/.exec(layout);
  if (cross?.[1] !== undefined) result.crossAxisAlign = cross[1];
  const sizing = /\bsizing ([^\s/]+)\/([^\s/]+)/.exec(layout);
  if (sizing !== null) {
    if (sizing[1] !== undefined && sizing[1] !== "-") result.sizingHorizontal = sizing[1];
    if (sizing[2] !== undefined && sizing[2] !== "-") result.sizingVertical = sizing[2];
  }

  return Object.keys(result).length > 0 ? (result as BlueprintLayout) : undefined;
}

/** `"Poppins Medium 20px"` → typed typography. */
function parseTypography(typography: string | undefined): BlueprintTypography | undefined {
  if (typography === undefined || typography.trim().length === 0) return undefined;
  const size = /(\d+(?:\.\d+)?)px$/.exec(typography);
  const words = typography.replace(/\s*\d+(?:\.\d+)?px$/, "").trim().split(/\s+/).filter((word) => word.length > 0);
  const result: { fontFamily?: string; fontStyle?: string; fontSizePx?: number } = {};
  if (words[0] !== undefined) result.fontFamily = words[0];
  if (words.length > 1) result.fontStyle = words.slice(1).join(" ");
  if (size !== null) result.fontSizePx = Number(size[1]);
  return Object.keys(result).length > 0 ? result : undefined;
}

function toStyle(style: EvidenceStyle | undefined): BlueprintStyle | undefined {
  if (style === undefined) return undefined;
  const radius = style.radius !== undefined ? Number(style.radius.replace(/px$/, "")) : undefined;
  const result: {
    background?: string;
    border?: string;
    radiusPx?: number;
    opacity?: number;
    effects: string[];
  } = { effects: [...(style.effects ?? [])] };
  if (style.background !== undefined) result.background = style.background;
  if (style.border !== undefined) result.border = style.border;
  if (radius !== undefined && Number.isFinite(radius)) result.radiusPx = radius;
  if (style.opacity !== undefined) result.opacity = style.opacity;
  return result;
}

function elementFrom(element: EvidenceElement, componentRefById: ReadonlyMap<string, string>): BlueprintElement {
  const { widthPx, heightPx } = parseSize(element.size);
  const layout = parseLayout(element.layout);
  const style = toStyle(element.style);
  const typography = parseTypography(element.typography);
  const componentRef = componentRefById.get(element.nodeId);

  const facts = {
    sourceNodeId: element.nodeId,
    name: element.name,
    nodeType: element.type,
    ...(element.text !== undefined ? { text: element.text } : {}),
    ...(widthPx !== undefined ? { widthPx } : {}),
    ...(heightPx !== undefined ? { heightPx } : {}),
    ...(layout !== undefined ? { layout } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(typography !== undefined ? { typography } : {}),
    ...(element.textColor !== undefined ? { textColor: element.textColor } : {}),
    ...(componentRef !== undefined ? { componentRef } : {}),
    observedStates: [] as string[],
  };

  return {
    id: element.nodeId,
    ...(element.parentId !== undefined ? { parentId: element.parentId } : {}),
    order: element.order,
    facts,
    semantics: { ...EMPTY_SEMANTICS },
  };
}

/**
 * Compiles the canonical Blueprint draft.
 *
 * Deterministic in the strict sense: same snapshot in, byte-identical
 * Blueprint out. No clock, no randomness, no model, no filesystem.
 */
export function compileUIBlueprintDraft(
  snapshot: FigmaSourceSnapshot,
  options: CompileUIBlueprintOptions = {},
): UIBlueprint {
  const bundle = compileSpecificationEvidenceBundle(snapshot);
  return compileUIBlueprintDraftFromBundle(bundle, snapshot, options);
}

/** The same compilation from an already-compiled bundle (avoids recompiling). */
export function compileUIBlueprintDraftFromBundle(
  bundle: SpecificationEvidenceBundle,
  snapshot: FigmaSourceSnapshot,
  options: CompileUIBlueprintOptions = {},
): UIBlueprint {
  const bounds: BlueprintBound[] = [];
  const bound = <T>(items: readonly T[], max: number, collection: string): readonly T[] => {
    if (items.length <= max) return items;
    bounds.push({
      collection,
      originalCount: items.length,
      retainedCount: max,
      reason: `bounded to the Blueprint schema maximum of ${max}`,
    });
    return items.slice(0, max);
  };

  // Instances are grouped by component ref in the bundle; the Blueprint keeps
  // that identity on the element so a consumer never has to re-derive it.
  const componentRefById = new Map(bundle.instances.map((instance) => [instance.nodeId, instance.componentRef]));

  const elements = bound(bundle.elements, MAX_ELEMENTS, "elements").map((element) =>
    elementFrom(element, componentRefById),
  );

  const instancesByRef = new Map<string, typeof bundle.instances>();
  for (const instance of bundle.instances) {
    instancesByRef.set(instance.componentRef, [...(instancesByRef.get(instance.componentRef) ?? []), instance]);
  }

  // Figma component identity, when the transport exposed it, keyed by the
  // instance node ids the bundle already grouped.
  const figmaComponentByNodeId = new Map(snapshot.components.map((component) => [component.id, component]));

  const components: BlueprintComponent[] = bound(bundle.components, MAX_COMPONENTS, "components").map((component) => {
    const instances = instancesByRef.get(component.ref) ?? [];
    const identity = component.componentIds
      .map((id) => figmaComponentByNodeId.get(id))
      .find((entry) => entry?.key !== undefined);
    const observedVariants = [
      ...new Set(
        instances.flatMap((instance) => Object.values(instance.propertyValues ?? {})),
      ),
    ];
    const declaredVariants = [
      ...new Set(
        component.componentIds
          .map((id) => figmaComponentByNodeId.get(id))
          .flatMap((entry) => Object.values(entry?.variantProperties ?? {})),
      ),
    ];
    const sharedSize = parseSize(component.sharedSize);
    const sharedStyle = toStyle(component.sharedStyle);
    const sharedLayout = parseLayout(component.sharedLayout);

    return {
      id: `component:${component.ref}`,
      name: component.name,
      ...(identity?.key !== undefined ? { figmaComponentId: identity.key } : {}),
      properties: (component.propertyNames ?? []).map((name) => ({
        name,
        values: [
          ...new Set(
            instances
              .map((instance) => instance.propertyValues?.[name])
              .filter((value): value is string => value !== undefined),
          ),
        ],
        source: "observedInSelection" as const,
      })),
      declaredVariants,
      observedVariants,
      anatomy: component.anatomy.map((entry) => ({
        name: entry.name,
        nodeType: entry.type,
        depth: entry.depth,
      })),
      sharedFacts: {
        ...(sharedSize.widthPx !== undefined ? { widthPx: sharedSize.widthPx } : {}),
        ...(sharedSize.heightPx !== undefined ? { heightPx: sharedSize.heightPx } : {}),
        ...(sharedStyle !== undefined ? { style: sharedStyle } : {}),
        ...(sharedLayout !== undefined ? { layout: sharedLayout } : {}),
      },
      instances: instances.map((instance) => ({
        elementId: instance.nodeId,
        sourceNodeId: instance.nodeId,
        ...(instance.name !== undefined ? { name: instance.name } : {}),
        ...(instance.propertyValues !== undefined ? { propertyValues: instance.propertyValues } : {}),
        contents: instance.contents.map((slot) => ({
          sourceNodeId: slot.nodeId,
          name: slot.name,
          nodeType: slot.type,
          depth: slot.depth,
          ...(slot.text !== undefined ? { text: slot.text } : {}),
        })),
        differences: [
          ...(instance.size !== undefined ? [`size ${instance.size}`] : []),
          ...(instance.layout !== undefined ? [`layout ${instance.layout}`] : []),
          ...(instance.style?.background !== undefined ? [`background ${instance.style.background}`] : []),
          ...(instance.style?.border !== undefined ? [`border ${instance.style.border}`] : []),
          ...(instance.style?.radius !== undefined ? [`radius ${instance.style.radius}`] : []),
        ],
      })),
      semantics: { ...EMPTY_SEMANTICS },
    };
  });

  const foundationValues = (values: readonly string[], source: "observed-value") =>
    values.map((value) => ({ value, source }));

  const screenSize = parseSize(bundle.screen?.size);
  const rootElementId = bundle.screen?.nodeId ?? elements[0]?.id ?? "";

  const draft = {
    schemaVersion: UI_BLUEPRINT_SCHEMA_VERSION,
    screen: {
      rootElementId,
      name: bundle.screen?.name ?? "Untitled screen",
      ...(screenSize.widthPx !== undefined ? { widthPx: screenSize.widthPx } : {}),
      ...(screenSize.heightPx !== undefined ? { heightPx: screenSize.heightPx } : {}),
      ...(bundle.screen?.background !== undefined ? { background: bundle.screen.background } : {}),
      ...(parseLayout(bundle.screen?.layout) !== undefined ? { layout: parseLayout(bundle.screen?.layout) } : {}),
    },
    elements,
    components,
    foundations: {
      colors: [
        ...bundle.foundations.variables
          .filter((variable) => /color|fill|stroke|surface|background/i.test(variable.name))
          .map((variable) => ({ value: variable.value, name: variable.name, source: "figma-variable" as const })),
        ...foundationValues(bundle.foundations.colors, "observed-value"),
      ],
      typography: foundationValues(bundle.foundations.typography, "observed-value"),
      spacing: foundationValues(bundle.foundations.spacing, "observed-value"),
      radii: foundationValues(bundle.foundations.radii, "observed-value"),
      borders: foundationValues(bundle.foundations.borders, "observed-value"),
      effects: foundationValues(bundle.foundations.effects, "observed-value"),
    },
    assets: bound(bundle.assets, MAX_ASSETS, "assets").map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      ...(asset.reference !== undefined ? { reference: asset.reference } : {}),
    })),
    interactions: bound(bundle.interactions, MAX_INTERACTIONS, "interactions").map((interaction) => ({
      sourceNodeId: interaction.nodeId,
      description: interaction.description,
    })),
    semanticRegions: [],
    relationships: [],
    // Retrieval facts the design reasoning must account for; never a prompt.
    uncertainties: bundle.notes.map((note, index) => ({
      code: note.split(":")[0] ?? `EVIDENCE_NOTE_${index}`,
      description: note,
      affectedIds: [],
      requiresUserInput: false,
    })),
    semanticEnrichment: {
      status: "not_requested" as const,
      partitionCount: 0,
      patchCount: 0,
      failures: [],
    },
    provenance: {
      designFile: bundle.source.designFile,
      ...(bundle.source.fileKey !== undefined ? { fileKey: bundle.source.fileKey } : {}),
      ...(bundle.source.documentVersion !== undefined ? { documentVersion: bundle.source.documentVersion } : {}),
      rootNodeIds: bundle.source.rootNodeIds,
      ...(options.snapshotArtifactId !== undefined ? { snapshotArtifactId: options.snapshotArtifactId } : {}),
      compilerVersion: UI_BLUEPRINT_COMPILER_VERSION,
      bounds,
    },
  };

  return uiBlueprintSchema.parse(draft);
}

export interface UIBlueprintMetrics {
  readonly snapshotBytes: number;
  readonly evidenceBundleBytes: number;
  readonly blueprintDraftBytes: number;
  readonly blueprintElementCount: number;
  readonly blueprintComponentCount: number;
}

/** Deterministic size/shape metrics for the trace. Counts and bytes only. */
export function measureUIBlueprint(
  snapshot: FigmaSourceSnapshot,
  blueprint: UIBlueprint,
): UIBlueprintMetrics {
  const bundle = compileSpecificationEvidenceBundle(snapshot);
  return {
    snapshotBytes: bundle.metrics.snapshotBytes,
    evidenceBundleBytes: bundle.metrics.bundleBytes,
    blueprintDraftBytes: new TextEncoder().encode(JSON.stringify(blueprint)).length,
    blueprintElementCount: blueprint.elements.length,
    blueprintComponentCount: blueprint.components.length,
  };
}
