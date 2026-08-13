// packages/agents/src/specification/compatibility/specification-projection.ts
//
// The Specification becomes a view.
//
// Until now the human-readable specification *was* the contract: a model
// authored it, downstream agents re-read it, and every fact it failed to
// carry was lost. In V2 it is a deterministic projection of the Blueprint —
// same facts, rendered for a person. Nothing here consults a model, and
// nothing here can state a fact the Blueprint does not already hold.
//
// Two projections live in this file:
//
//   renderBlueprintSpecification    → sectioned document for the TUI/report
//   blueprintToDesignSpecification  → the legacy `DesignSpecification` V2
//                                     artifact, so the current Project
//                                     Analysis / Implementation consumers
//                                     keep working unchanged during migration
import {
  designSpecificationSchema,
  type DesignSpecification,
  type SpecElement,
  type SpecRegion,
  type UIBlueprint,
} from "@designflow/sdk";

export interface SpecificationSection {
  readonly title: string;
  readonly lines: readonly string[];
}

function px(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}px`;
}

function styleLine(blueprint: UIBlueprint, elementId: string): string | undefined {
  const element = blueprint.elements.find((entry) => entry.id === elementId);
  if (element === undefined) return undefined;
  const parts = [
    px(element.facts.widthPx) !== undefined && px(element.facts.heightPx) !== undefined
      ? `${element.facts.widthPx}×${element.facts.heightPx}`
      : undefined,
    element.facts.style?.background !== undefined ? `bg ${element.facts.style.background}` : undefined,
    element.facts.style?.border !== undefined ? `border ${element.facts.style.border}` : undefined,
    element.facts.style?.radiusPx !== undefined ? `radius ${element.facts.style.radiusPx}px` : undefined,
    element.facts.typography?.fontFamily !== undefined
      ? [element.facts.typography.fontFamily, element.facts.typography.fontStyle, px(element.facts.typography.fontSizePx)]
          .filter((part) => part !== undefined)
          .join(" ")
      : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Renders the sectioned human-readable specification.
 *
 * Every value comes from the Blueprint. Where semantic enrichment ran, the
 * section headings and roles read better; where it did not, the same factual
 * content is present with structural names — which is the property that makes
 * design truth independent of model availability.
 */
export function renderBlueprintSpecification(blueprint: UIBlueprint): readonly SpecificationSection[] {
  const elementById = new Map(blueprint.elements.map((element) => [element.id, element]));
  const sections: SpecificationSection[] = [];

  sections.push({
    title: "Screen",
    lines: [
      blueprint.screen.name,
      ...(blueprint.screen.widthPx !== undefined && blueprint.screen.heightPx !== undefined
        ? [`${blueprint.screen.widthPx}×${blueprint.screen.heightPx}`]
        : []),
      ...(blueprint.screen.background !== undefined ? [`Background ${blueprint.screen.background}`] : []),
      ...(blueprint.screen.layout?.direction !== undefined
        ? [`Layout ${blueprint.screen.layout.direction}${blueprint.screen.layout.gapPx !== undefined ? ` gap ${blueprint.screen.layout.gapPx}px` : ""}`]
        : []),
    ],
  });

  // Page anatomy: semantic regions when they exist, the evidenced top-level
  // containers otherwise. Both are Blueprint facts; only the naming differs.
  const anatomyLines: string[] = [];
  if (blueprint.semanticRegions.length > 0) {
    for (const region of blueprint.semanticRegions) {
      anatomyLines.push(`${region.name}${region.semantics.role !== undefined ? ` (${region.semantics.role})` : ""}`);
      for (const memberId of region.memberElementIds.slice(0, 12)) {
        const member = elementById.get(memberId);
        if (member === undefined) continue;
        const label = member.facts.text ?? member.facts.name ?? memberId;
        const style = styleLine(blueprint, memberId);
        anatomyLines.push(`  - ${label}${style !== undefined ? ` — ${style}` : ""}`);
      }
    }
  } else {
    const topLevel = blueprint.elements
      .filter((element) => element.parentId === blueprint.screen.rootElementId)
      .sort((left, right) => left.order - right.order);
    for (const element of topLevel) {
      anatomyLines.push(element.facts.name ?? element.id);
      const children = blueprint.elements
        .filter((child) => child.parentId === element.id)
        .sort((left, right) => left.order - right.order)
        .slice(0, 12);
      for (const child of children) {
        const label = child.facts.text ?? child.facts.name ?? child.id;
        const style = styleLine(blueprint, child.id);
        anatomyLines.push(`  - ${label}${style !== undefined ? ` — ${style}` : ""}`);
      }
    }
  }
  sections.push({ title: "Page anatomy", lines: anatomyLines });

  sections.push({
    title: "Components",
    lines: blueprint.components.flatMap((component) => [
      `${component.name} × ${component.instances.length}${component.semantics.purpose !== undefined ? ` — ${component.semantics.purpose}` : ""}`,
      ...(component.sharedFacts.heightPx !== undefined || component.sharedFacts.style !== undefined
        ? [
            `  shared: ${[
              component.sharedFacts.widthPx !== undefined && component.sharedFacts.heightPx !== undefined
                ? `${component.sharedFacts.widthPx}×${component.sharedFacts.heightPx}`
                : undefined,
              component.sharedFacts.style?.background !== undefined ? `bg ${component.sharedFacts.style.background}` : undefined,
              component.sharedFacts.style?.border !== undefined ? `border ${component.sharedFacts.style.border}` : undefined,
              component.sharedFacts.style?.radiusPx !== undefined ? `radius ${component.sharedFacts.style.radiusPx}px` : undefined,
            ]
              .filter((part) => part !== undefined)
              .join(" · ")}`,
          ]
        : []),
      ...component.instances.map((instance) => {
        const contents = instance.contents
          .map((slot) => slot.text ?? slot.name)
          .filter((entry): entry is string => entry !== undefined)
          .slice(0, 6)
          .join(" / ");
        return `  ${instance.name ?? instance.elementId}${contents.length > 0 ? `: ${contents}` : ""}`;
      }),
      ...(Object.keys(component.instances[0]?.propertyValues ?? {}).length > 0
        ? [`  properties: ${component.properties.map((property) => `${property.name}=${property.values.join("|")}`).join(", ")}`]
        : []),
    ]),
  });

  sections.push({
    title: "Design foundations",
    lines: [
      ...(blueprint.foundations.colors.length > 0
        ? [`Colors: ${blueprint.foundations.colors.map((entry) => entry.name ?? entry.value).join(", ")}`]
        : []),
      ...(blueprint.foundations.typography.length > 0
        ? [`Typography: ${blueprint.foundations.typography.map((entry) => entry.value).join(", ")}`]
        : []),
      ...(blueprint.foundations.spacing.length > 0
        ? [`Spacing: ${blueprint.foundations.spacing.map((entry) => entry.value).join(", ")}`]
        : []),
      ...(blueprint.foundations.radii.length > 0
        ? [`Radii: ${blueprint.foundations.radii.map((entry) => entry.value).join(", ")}`]
        : []),
      ...(blueprint.foundations.borders.length > 0
        ? [`Borders: ${blueprint.foundations.borders.map((entry) => entry.value).join(", ")}`]
        : []),
      ...(blueprint.foundations.effects.length > 0
        ? [`Effects: ${blueprint.foundations.effects.map((entry) => entry.value).join(", ")}`]
        : []),
    ],
  });

  sections.push({ title: "Content", lines: blueprintContent(blueprint) });

  sections.push({
    title: "Interactions & states",
    lines: [
      ...blueprint.interactions.map((interaction) => interaction.description),
      ...blueprint.elements
        .filter((element) => element.semantics.interactionKind !== undefined && element.semantics.interactionKind !== "none")
        .map(
          (element) =>
            `${element.facts.text ?? element.facts.name ?? element.id}: ${element.semantics.interactionKind}${element.semantics.evidenceBasis !== undefined ? ` (${element.semantics.evidenceBasis})` : ""}`,
        ),
      ...blueprint.relationships.map((relationship) => `${relationship.fromId} ${relationship.kind} ${relationship.toId}`),
    ],
  });

  sections.push({
    title: "Assets",
    lines: blueprint.assets.map((asset) => `${asset.name} (${asset.type})`),
  });

  sections.push({
    title: "Uncertainties",
    lines: [
      ...blueprint.uncertainties.map((uncertainty) => `${uncertainty.code}: ${uncertainty.description}`),
      ...(blueprint.semanticEnrichment.status === "unavailable"
        ? ["Semantic interpretation was unavailable; the design facts above are unaffected."]
        : []),
      ...(blueprint.semanticEnrichment.status === "partial"
        ? [
            `Semantic interpretation was partial (${blueprint.semanticEnrichment.patchCount}/${blueprint.semanticEnrichment.partitionCount} partitions).`,
          ]
        : []),
      ...blueprint.provenance.bounds.map(
        (bound) => `${bound.collection}: retained ${bound.retainedCount} of ${bound.originalCount} — ${bound.reason}`,
      ),
    ],
  });

  return sections;
}

/** Exact visible copy in source order, deduplicated. */
export function blueprintContent(blueprint: UIBlueprint): string[] {
  const texts: string[] = [];
  for (const element of blueprint.elements) {
    if (element.facts.text !== undefined) texts.push(element.facts.text);
  }
  for (const component of blueprint.components) {
    for (const instance of component.instances) {
      for (const slot of instance.contents) {
        if (slot.text !== undefined) texts.push(slot.text);
      }
    }
  }
  return [...new Set(texts)];
}

// ── Legacy compatibility projection ─────────────────────────────

function specElementFor(blueprint: UIBlueprint, elementId: string, depth: number): SpecElement {
  const element = blueprint.elements.find((entry) => entry.id === elementId)!;
  const children =
    depth > 0
      ? blueprint.elements
          .filter((child) => child.parentId === elementId)
          .sort((left, right) => left.order - right.order)
          .map((child) => specElementFor(blueprint, child.id, depth - 1))
      : [];
  return {
    nodeId: element.id,
    name: element.facts.name ?? element.id,
    ...(element.semantics.role !== undefined
      ? { role: element.semantics.role === "form_control" ? "form-field" : element.semantics.role }
      : element.facts.nodeType === "TEXT"
        ? { role: "text" }
        : element.facts.componentRef !== undefined
          ? { role: "component-instance" }
          : {}),
    ...(element.facts.text !== undefined ? { text: element.facts.text } : {}),
    ...(element.facts.widthPx !== undefined ? { width: `${element.facts.widthPx}px` } : {}),
    ...(element.facts.heightPx !== undefined ? { height: `${element.facts.heightPx}px` } : {}),
    ...(element.facts.layout?.direction !== undefined
      ? {
          layout: {
            direction: element.facts.layout.direction,
            ...(element.facts.layout.gapPx !== undefined ? { gap: `${element.facts.layout.gapPx}px` } : {}),
            ...(element.facts.layout.paddingTopPx !== undefined
              ? {
                  padding: `${element.facts.layout.paddingTopPx}px ${element.facts.layout.paddingRightPx ?? 0}px ${element.facts.layout.paddingBottomPx ?? 0}px ${element.facts.layout.paddingLeftPx ?? 0}px`,
                }
              : {}),
          },
        }
      : {}),
    ...(element.facts.style?.background !== undefined ? { background: element.facts.style.background } : {}),
    ...(element.facts.style?.border !== undefined ? { border: element.facts.style.border } : {}),
    ...(element.facts.style?.radiusPx !== undefined ? { radius: `${element.facts.style.radiusPx}px` } : {}),
    ...(element.facts.style?.opacity !== undefined ? { opacity: element.facts.style.opacity } : {}),
    ...(element.facts.typography !== undefined || element.facts.textColor !== undefined
      ? {
          typography: {
            ...(element.facts.typography?.fontFamily !== undefined ? { family: element.facts.typography.fontFamily } : {}),
            ...(element.facts.typography?.fontStyle !== undefined ? { weight: element.facts.typography.fontStyle } : {}),
            ...(element.facts.typography?.fontSizePx !== undefined ? { size: `${element.facts.typography.fontSizePx}px` } : {}),
            ...(element.facts.typography?.lineHeight !== undefined ? { lineHeight: element.facts.typography.lineHeight } : {}),
            ...(element.facts.typography?.letterSpacing !== undefined ? { letterSpacing: element.facts.typography.letterSpacing } : {}),
            ...(element.facts.typography?.textAlign !== undefined ? { align: element.facts.typography.textAlign } : {}),
            ...(element.facts.textColor !== undefined ? { color: element.facts.textColor } : {}),
          },
        }
      : {}),
    effects: element.facts.style?.effects ?? [],
    states: [...element.facts.observedStates],
    notes: [],
    children,
  };
}

/**
 * Projects the Blueprint onto the legacy `DesignSpecification` V2 artifact.
 *
 * The compatibility bridge for V2-1 (audit option A): downstream consumers —
 * `map-design-system`, `deriveImplementationCoveragePlan`,
 * `store-implementation-plan`, the TUI specification viewer — keep reading
 * the artifact they already read, while the Blueprint becomes the thing that
 * actually holds the truth. No consumer is migrated in this phase, and none
 * has to be for the Blueprint to be correct.
 */
export function blueprintToDesignSpecification(
  blueprint: UIBlueprint,
  options: { readonly agentVersion: string; readonly screenshotArtifactIds?: readonly string[] },
): DesignSpecification {
  const root = blueprint.screen.rootElementId;
  const regions: SpecRegion[] =
    blueprint.semanticRegions.length > 0
      ? blueprint.semanticRegions.map((region) => ({
          ...(region.anchorElementId !== undefined ? { nodeId: region.anchorElementId } : {}),
          name: region.name,
          elements: region.memberElementIds
            .filter((memberId) => blueprint.elements.some((element) => element.id === memberId))
            .slice(0, 24)
            .map((memberId) => specElementFor(blueprint, memberId, 0)),
        }))
      : blueprint.elements
          .filter((element) => element.parentId === root)
          .sort((left, right) => left.order - right.order)
          .map((element) => ({
            nodeId: element.id,
            name: element.facts.name ?? element.id,
            elements: [specElementFor(blueprint, element.id, 2)],
          }));

  const spec = {
    sourceIdentity: {
      designFile: blueprint.provenance.designFile,
      ...(blueprint.provenance.fileKey !== undefined ? { fileKey: blueprint.provenance.fileKey } : {}),
      ...(blueprint.provenance.documentVersion !== undefined
        ? { documentVersion: blueprint.provenance.documentVersion }
        : {}),
    },
    agentVersion: options.agentVersion,
    screenshotArtifactIds: [...(options.screenshotArtifactIds ?? [])],
    frames: [blueprint.screen.name],
    hierarchy: blueprint.elements.map((element) => ({
      id: element.id,
      name: element.facts.name ?? element.id,
      ...(element.parentId !== undefined ? { parentId: element.parentId } : {}),
    })),
    designTokens: {
      colors: blueprint.foundations.colors.map((entry) => entry.name ?? entry.value),
      spacing: blueprint.foundations.spacing.map((entry) => entry.value),
      typography: blueprint.foundations.typography.map((entry) => entry.value),
      radii: blueprint.foundations.radii.map((entry) => entry.value),
      borders: blueprint.foundations.borders.map((entry) => entry.value),
      shadows: blueprint.foundations.effects.map((entry) => entry.value),
      referencedVariableNames: blueprint.foundations.colors
        .filter((entry) => entry.source === "figma-variable" && entry.name !== undefined)
        .map((entry) => entry.name!),
    },
    components: blueprint.components.map((component) => ({
      name: component.name,
      role: component.semantics.role ?? "INSTANCE",
      sourceNodeIds: component.instances.map((instance) => instance.sourceNodeId),
      variants: component.observedVariants,
      reusableAssessment: "uncertain" as const,
      requiredAssets: [],
      implementationNotes: [],
    })),
    layoutBehavior: [],
    responsiveAssumptions: [],
    assets: blueprint.assets.map((asset) => ({ id: asset.id, name: asset.name })),
    content: blueprintContent(blueprint),
    interactions: blueprint.interactions.map((interaction) => interaction.description),
    states: [...new Set(blueprint.elements.flatMap((element) => element.facts.observedStates))],
    accessibilityNotes: [],
    ambiguities: blueprint.uncertainties.map((uncertainty) => ({
      code: uncertainty.code,
      description: uncertainty.description,
      affectedNodeIds: [...uncertainty.affectedIds],
      requiresUserInput: uncertainty.requiresUserInput,
    })),
    screen: {
      name: blueprint.screen.name,
      ...(blueprint.screen.widthPx !== undefined ? { width: `${blueprint.screen.widthPx}px` } : {}),
      ...(blueprint.screen.heightPx !== undefined ? { height: `${blueprint.screen.heightPx}px` } : {}),
      ...(blueprint.screen.background !== undefined ? { background: blueprint.screen.background } : {}),
    },
    anatomy: regions,
    foundations: {
      colors: blueprint.foundations.colors.map((entry) => ({
        value: entry.value,
        ...(entry.name !== undefined ? { name: entry.name } : {}),
        source: entry.source,
      })),
      typography: blueprint.foundations.typography.map((entry) => ({ value: entry.value, source: entry.source })),
      spacing: blueprint.foundations.spacing.map((entry) => ({ value: entry.value, source: entry.source })),
      radii: blueprint.foundations.radii.map((entry) => ({ value: entry.value, source: entry.source })),
      borders: blueprint.foundations.borders.map((entry) => ({ value: entry.value, source: entry.source })),
      shadows: blueprint.foundations.effects.map((entry) => ({ value: entry.value, source: entry.source })),
      iconSizing: [],
    },
    componentContracts: blueprint.components.map((component) => ({
      name: component.name,
      ...(component.figmaComponentId !== undefined ? { componentKey: component.figmaComponentId } : {}),
      sourceNodeIds: component.instances.map((instance) => instance.sourceNodeId),
      anatomy: component.anatomy.map((entry) => entry.name),
      baseStyles: [
        ...(component.sharedFacts.heightPx !== undefined ? [`height ${component.sharedFacts.heightPx}px`] : []),
        ...(component.sharedFacts.style?.background !== undefined ? [`background ${component.sharedFacts.style.background}`] : []),
        ...(component.sharedFacts.style?.border !== undefined ? [`border ${component.sharedFacts.style.border}`] : []),
        ...(component.sharedFacts.style?.radiusPx !== undefined ? [`radius ${component.sharedFacts.style.radiusPx}px`] : []),
      ],
      componentProperties: component.properties.map((property) => ({
        name: property.name,
        values: property.values,
        source: property.source,
      })),
      variants: component.observedVariants.map((variant) => ({
        name: variant,
        source: "observedInSelection" as const,
      })),
      states: [],
      instances: component.instances.map((instance) => ({
        nodeId: instance.sourceNodeId,
        // The legacy contract carries one label per instance; the exact
        // per-slot content stays addressable on the Blueprint itself.
        label: instance.name ?? instance.sourceNodeId,
        ...(instance.propertyValues !== undefined ? { propertyValues: instance.propertyValues } : {}),
        differences: [
          ...instance.differences,
          ...instance.contents
            .map((slot) => slot.text)
            .filter((text): text is string => text !== undefined)
            .map((text) => `content: ${text}`),
        ],
      })),
      usedBy: [],
    })),
    assetDetails: blueprint.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      ...(asset.reference !== undefined ? { reference: asset.reference } : {}),
    })),
    observedStates: [...new Set(blueprint.elements.flatMap((element) => element.facts.observedStates))],
    inferredBehavior: blueprint.elements
      .filter(
        (element) =>
          element.semantics.interactionKind !== undefined &&
          element.semantics.interactionKind !== "none" &&
          (element.semantics.evidenceBasis === "visual_inference" ||
            element.semantics.evidenceBasis === "semantic_inference"),
      )
      .map(
        (element) =>
          `${element.facts.name ?? element.id}: ${element.semantics.interactionKind} (inferred, ${element.semantics.evidenceBasis})`,
      ),
    responsiveEvidence: [],
  };

  return designSpecificationSchema.parse(spec);
}
