// packages/agents/src/catalog/specification-wire.ts
//
// Specification V2 wire ↔ internal artifact bridge.
//
// The provider-facing structured-output schema is a PORTABLE flat subset
// (see `figmaSpecificationResponseSchema`): closed shallow objects, every
// property required, nullable scalars only. This module owns the other half
// of that contract: a Zod parse of the wire shape, and the deterministic
// reconstruction of the rich internal `DesignSpecification` V2 artifact —
// nested anatomy, structured layout/typography, component contracts,
// foundations, and the derived legacy summary fields. No information the
// wire carries is dropped; only nesting is rebuilt.
import { z } from "zod";
import {
  designSpecificationSchema,
  type DesignSpecification,
  type SpecElement,
  type SpecRegion,
} from "@designflow/sdk";

const nullableText = z.string().min(1).nullish();
const strings = z.array(z.string().min(1)).default([]);
const evidenceSource = z.enum(["observedInSelection", "declaredByFigmaComponentMetadata"]);

const wireElementSchema = z
  .object({
    region: z.string().min(1),
    parent: nullableText,
    nodeId: nullableText,
    name: z.string().min(1),
    role: nullableText,
    text: nullableText,
    width: nullableText,
    height: nullableText,
    layoutDirection: nullableText,
    gap: nullableText,
    padding: nullableText,
    align: nullableText,
    justify: nullableText,
    sizing: nullableText,
    position: nullableText,
    background: nullableText,
    border: nullableText,
    radius: nullableText,
    opacity: z.number().min(0).max(1).nullish(),
    fontFamily: nullableText,
    fontWeight: nullableText,
    fontSize: nullableText,
    lineHeight: nullableText,
    letterSpacing: nullableText,
    textColor: nullableText,
    textAlign: nullableText,
    effects: strings,
    asset: nullableText,
    componentName: nullableText,
    states: strings,
    notes: strings,
  })
  .strip();

const foundationValues = z
  .array(
    z
      .object({
        value: z.string().min(1),
        name: nullableText,
        source: z.enum(["figma-variable", "observed-value"]),
        usage: nullableText,
      })
      .strip(),
  )
  .default([]);

export const figmaSpecificationWireSchema = z
  .object({
    schemaVersion: z.string().min(1).default("3"),
    sourceIdentity: z.object({ designFile: z.string().min(1) }).strip(),
    rootNodeId: nullableText,
    screen: z
      .object({
        name: z.string().min(1),
        width: nullableText,
        height: nullableText,
        layoutModel: nullableText,
        background: nullableText,
        scrollBehavior: nullableText,
      })
      .strip()
      .nullish(),
    regions: z.array(z.object({ nodeId: nullableText, name: z.string().min(1), role: nullableText }).strip()).default([]),
    elements: z.array(wireElementSchema).default([]),
    componentContracts: z
      .array(
        z
          .object({
            name: z.string().min(1),
            componentKey: nullableText,
            componentSetName: nullableText,
            sourceNodeIds: strings,
            anatomy: strings,
            baseStyles: strings,
            componentProperties: z.array(z.object({ name: z.string().min(1), values: strings, source: evidenceSource }).strip()).default([]),
            variants: z.array(z.object({ name: z.string().min(1), source: evidenceSource }).strip()).default([]),
            states: strings,
            instances: z.array(z.object({ nodeId: nullableText, label: z.string().min(1), differences: strings }).strip()).default([]),
            usedBy: strings,
          })
          .strip(),
      )
      .default([]),
    foundations: z
      .object({
        colors: foundationValues,
        typography: foundationValues,
        spacing: foundationValues,
        radii: foundationValues,
        borders: foundationValues,
        shadows: foundationValues,
        iconSizing: foundationValues,
      })
      .strip()
      .nullish(),
    assetDetails: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            type: z.string().min(1),
            reference: nullableText,
            width: nullableText,
            height: nullableText,
            purpose: nullableText,
          })
          .strip(),
      )
      .default([]),
    content: strings,
    observedStates: strings,
    inferredBehavior: strings,
    responsiveEvidence: strings,
    interactions: strings,
    states: strings,
    accessibilityNotes: strings,
    layoutBehavior: strings,
    responsiveAssumptions: strings,
    frames: strings,
    ambiguities: z
      .array(
        z
          .object({
            code: z.string().min(1),
            description: z.string().min(1),
            affectedNodeIds: strings,
            requiresUserInput: z.boolean().default(false),
          })
          .strip(),
      )
      .default([]),
  })
  .strip();

export type FigmaSpecificationWire = z.infer<typeof figmaSpecificationWireSchema>;

type WireElement = FigmaSpecificationWire["elements"][number];

interface MutableElement {
  readonly wire: WireElement;
  readonly children: MutableElement[];
}

function toSpecElement(entry: MutableElement): SpecElement {
  const wire = entry.wire;
  const hasLayout =
    wire.layoutDirection != null || wire.gap != null || wire.padding != null ||
    wire.align != null || wire.justify != null || wire.sizing != null || wire.position != null;
  const hasTypography =
    wire.fontFamily != null || wire.fontWeight != null || wire.fontSize != null ||
    wire.lineHeight != null || wire.letterSpacing != null || wire.textColor != null || wire.textAlign != null;
  const direction =
    wire.layoutDirection === "horizontal" || wire.layoutDirection === "vertical" || wire.layoutDirection === "none"
      ? wire.layoutDirection
      : undefined;
  return {
    ...(wire.nodeId != null ? { nodeId: wire.nodeId } : {}),
    name: wire.name,
    ...(wire.role != null ? { role: wire.role } : {}),
    ...(wire.text != null ? { text: wire.text } : {}),
    ...(wire.width != null ? { width: wire.width } : {}),
    ...(wire.height != null ? { height: wire.height } : {}),
    ...(hasLayout
      ? {
          layout: {
            ...(direction !== undefined ? { direction } : {}),
            ...(wire.gap != null ? { gap: wire.gap } : {}),
            ...(wire.padding != null ? { padding: wire.padding } : {}),
            ...(wire.align != null ? { align: wire.align } : {}),
            ...(wire.justify != null ? { justify: wire.justify } : {}),
            ...(wire.sizing != null ? { sizing: wire.sizing } : {}),
            ...(wire.position != null ? { position: wire.position } : {}),
          },
        }
      : {}),
    ...(wire.background != null ? { background: wire.background } : {}),
    ...(wire.border != null ? { border: wire.border } : {}),
    ...(wire.radius != null ? { radius: wire.radius } : {}),
    ...(wire.opacity != null ? { opacity: wire.opacity } : {}),
    ...(hasTypography
      ? {
          typography: {
            ...(wire.fontFamily != null ? { family: wire.fontFamily } : {}),
            ...(wire.fontWeight != null ? { weight: wire.fontWeight } : {}),
            ...(wire.fontSize != null ? { size: wire.fontSize } : {}),
            ...(wire.lineHeight != null ? { lineHeight: wire.lineHeight } : {}),
            ...(wire.letterSpacing != null ? { letterSpacing: wire.letterSpacing } : {}),
            ...(wire.textColor != null ? { color: wire.textColor } : {}),
            ...(wire.textAlign != null ? { align: wire.textAlign } : {}),
          },
        }
      : {}),
    effects: wire.effects,
    ...(wire.asset != null ? { asset: wire.asset } : {}),
    ...(wire.componentName != null ? { componentName: wire.componentName } : {}),
    states: wire.states,
    notes: wire.notes,
    children: entry.children.map(toSpecElement),
  };
}

/**
 * Rebuilds nested region anatomy from the flat element list. Elements attach
 * to the most recently seen element with their `parent` name inside the same
 * region (deterministic for the duplicate-name case), or to the region root
 * when `parent` is null/unknown.
 */
function buildAnatomy(wire: FigmaSpecificationWire): SpecRegion[] {
  const regions = new Map<string, { nodeId?: string; name: string; role?: string; roots: MutableElement[] }>();
  for (const region of wire.regions) {
    regions.set(region.name, {
      ...(region.nodeId != null ? { nodeId: region.nodeId } : {}),
      name: region.name,
      ...(region.role != null ? { role: region.role } : {}),
      roots: [],
    });
  }

  const lastByName = new Map<string, MutableElement>();
  for (const element of wire.elements) {
    let region = regions.get(element.region);
    if (region === undefined) {
      region = { name: element.region, roots: [] };
      regions.set(element.region, region);
    }
    const entry: MutableElement = { wire: element, children: [] };
    const parent = element.parent != null ? lastByName.get(`${element.region}::${element.parent}`) : undefined;
    if (parent !== undefined) parent.children.push(entry);
    else region.roots.push(entry);
    lastByName.set(`${element.region}::${element.name}`, entry);
  }

  return [...regions.values()].map((region) => ({
    ...(region.nodeId !== undefined ? { nodeId: region.nodeId } : {}),
    name: region.name,
    ...(region.role !== undefined ? { role: region.role } : {}),
    elements: region.roots.map(toSpecElement),
  }));
}

export interface WireNormalizationContext {
  /** The snapshot's resolved root node id, used when the wire omits one. */
  readonly fallbackRootNodeId?: string | undefined;
  readonly screenshotArtifactIds?: readonly string[] | undefined;
}

/**
 * Deterministically reconstructs the full internal Specification V2 artifact
 * from the portable wire response. Legacy summary fields (hierarchy,
 * designTokens, components, assets) are derived from the richer sections so
 * downstream consumers keep working unchanged.
 */
export function wireToDesignSpecification(
  raw: unknown,
  context: WireNormalizationContext = {},
): unknown {
  const wire = figmaSpecificationWireSchema.parse(raw);
  const anatomy = buildAnatomy(wire);
  const foundations = wire.foundations ?? undefined;

  // `content[]` is a DERIVED normalized index of visible copy, not a second
  // thing the model must repeat. Element-level text is the primary carrier;
  // the index unions the wire's explicit entries with every element text, in
  // document order, deduplicated exactly.
  const contentIndex: string[] = [];
  const seenContent = new Set<string>();
  const pushContent = (text: string | null | undefined): void => {
    if (text == null || text.trim().length === 0) return;
    if (seenContent.has(text)) return;
    seenContent.add(text);
    contentIndex.push(text);
  };
  for (const line of wire.content) pushContent(line);
  for (const element of wire.elements) pushContent(element.text);

  const rootNodeId = wire.rootNodeId ?? context.fallbackRootNodeId;
  const hierarchy: { id: string; name: string; parentId?: string }[] = [];
  if (rootNodeId !== undefined && rootNodeId !== null) {
    hierarchy.push({ id: rootNodeId, name: wire.screen?.name ?? "Screen" });
  }
  for (const region of wire.regions) {
    if (region.nodeId != null) {
      hierarchy.push({
        id: region.nodeId,
        name: region.name,
        ...(rootNodeId != null ? { parentId: rootNodeId } : {}),
      });
    }
  }
  for (const element of wire.elements) {
    if (element.nodeId != null && !hierarchy.some((entry) => entry.id === element.nodeId)) {
      hierarchy.push({ id: element.nodeId, name: element.name });
    }
  }

  const foundationValuesOf = (values: readonly { value: string; name?: string | null | undefined }[] | undefined): string[] =>
    (values ?? []).map((item) => (item.name != null ? item.name : item.value));

  const specification = {
    schemaVersion: "3",
    sourceIdentity: wire.sourceIdentity,
    frames: wire.frames.length > 0 ? wire.frames : wire.screen !== undefined && wire.screen !== null ? [wire.screen.name] : [],
    screenshotArtifactIds: [...(context.screenshotArtifactIds ?? [])],
    hierarchy,
    designTokens: {
      colors: foundationValuesOf(foundations?.colors),
      spacing: foundationValuesOf(foundations?.spacing),
      typography: foundationValuesOf(foundations?.typography),
      radii: foundationValuesOf(foundations?.radii),
      borders: foundationValuesOf(foundations?.borders),
      shadows: foundationValuesOf(foundations?.shadows),
      referencedVariableNames: Object.values(foundations ?? {})
        .flat()
        .flatMap((item) => (item.source === "figma-variable" && item.name != null ? [item.name] : [])),
    },
    components: wire.componentContracts.map((contract) => ({
      name: contract.name,
      role: "component",
      sourceNodeIds: contract.sourceNodeIds,
      variants: contract.variants.map((variant) => variant.name),
      requiredAssets: [],
      implementationNotes: [],
    })),
    layoutBehavior: wire.layoutBehavior,
    responsiveAssumptions: wire.responsiveAssumptions,
    assets: wire.assetDetails.map((asset) => ({ id: asset.id, name: asset.name })),
    content: contentIndex,
    interactions: wire.interactions,
    states: wire.states,
    accessibilityNotes: wire.accessibilityNotes,
    ambiguities: wire.ambiguities,
    ...(wire.screen !== undefined && wire.screen !== null
      ? {
          screen: {
            name: wire.screen.name,
            ...(wire.screen.width != null ? { width: wire.screen.width } : {}),
            ...(wire.screen.height != null ? { height: wire.screen.height } : {}),
            ...(wire.screen.layoutModel != null ? { layoutModel: wire.screen.layoutModel } : {}),
            ...(wire.screen.background != null ? { background: wire.screen.background } : {}),
            ...(wire.screen.scrollBehavior != null ? { scrollBehavior: wire.screen.scrollBehavior } : {}),
          },
        }
      : {}),
    anatomy,
    componentContracts: wire.componentContracts.map((contract) => ({
      name: contract.name,
      ...(contract.componentKey != null ? { componentKey: contract.componentKey } : {}),
      ...(contract.componentSetName != null ? { componentSetName: contract.componentSetName } : {}),
      sourceNodeIds: contract.sourceNodeIds,
      anatomy: contract.anatomy,
      baseStyles: contract.baseStyles,
      componentProperties: contract.componentProperties,
      variants: contract.variants,
      states: contract.states,
      instances: contract.instances.map((instance) => ({
        ...(instance.nodeId != null ? { nodeId: instance.nodeId } : {}),
        label: instance.label,
        differences: instance.differences,
      })),
      usedBy: contract.usedBy,
    })),
    ...(foundations !== undefined && foundations !== null
      ? {
          foundations: {
            colors: cleanFoundations(foundations.colors),
            typography: cleanFoundations(foundations.typography),
            spacing: cleanFoundations(foundations.spacing),
            radii: cleanFoundations(foundations.radii),
            borders: cleanFoundations(foundations.borders),
            shadows: cleanFoundations(foundations.shadows),
            iconSizing: cleanFoundations(foundations.iconSizing),
          },
        }
      : {}),
    assetDetails: wire.assetDetails.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      ...(asset.reference != null ? { reference: asset.reference } : {}),
      ...(asset.width != null ? { width: asset.width } : {}),
      ...(asset.height != null ? { height: asset.height } : {}),
      ...(asset.purpose != null ? { purpose: asset.purpose } : {}),
    })),
    observedStates: wire.observedStates,
    inferredBehavior: wire.inferredBehavior,
    responsiveEvidence: wire.responsiveEvidence,
  };

  // Round-trip through the authoritative artifact schema so the caller
  // receives exactly what any other producer of a DesignSpecification emits.
  return designSpecificationSchema.parse({ ...specification, agentVersion: "pending" }) satisfies DesignSpecification;
}

function cleanFoundations(
  values: readonly { value: string; name?: string | null | undefined; source: "figma-variable" | "observed-value"; usage?: string | null | undefined }[],
): { value: string; name?: string; source: "figma-variable" | "observed-value"; usage?: string }[] {
  return values.map((item) => ({
    value: item.value,
    ...(item.name != null ? { name: item.name } : {}),
    source: item.source,
    ...(item.usage != null ? { usage: item.usage } : {}),
  }));
}
