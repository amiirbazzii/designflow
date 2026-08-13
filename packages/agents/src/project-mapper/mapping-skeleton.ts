// packages/agents/src/project-mapper/mapping-skeleton.ts
//
// The deterministic Implementation Map skeleton.
//
//   UIBlueprint (design truth) + CanonicalProjectContext (project truth)
//                              ↓
//                    compileImplementationMapDraft
//                              ↓
//        every requirement, every candidate, every binding — no decisions
//
// The same discipline the Blueprint compiler establishes, one stage on: the
// host owns every reference, so the model's patch can only *choose among*
// things that exist. Requirements come from the Blueprint and cannot be added
// or removed by a patch; candidates come from ProjectContext and are the only
// project references a decision may name.
//
// Component definitions and component *instances* are separate requirements
// on purpose. "TextField maps to the existing TextField" is not proof that
// the card selector's trailing chevron is supported — that is exactly how a
// blanket `reuse` hides a component that cannot express one of its six uses.
import {
  implementationMapDraftSchema,
  IMPLEMENTATION_MAP_SCHEMA_VERSION,
  type CanonicalProjectContext,
  type ImplementationMapDraft,
  type MappingBound,
  type MappingRequirement,
  type UIBlueprint,
} from "@designflow/sdk";

import {
  buildComponentCandidates,
  plannedDirectoriesFor,
  projectAssetsFor,
  projectTokensFor,
  type CandidateSet,
} from "./candidate-builder";

export const IMPLEMENTATION_MAP_COMPILER_VERSION = "1";

/** Requirement bound. Reached only by very large designs; always reported. */
export const MAX_REQUIREMENTS = 300;

export interface CompileDraftOptions {
  readonly blueprintArtifactId?: string;
  readonly projectContextArtifactId?: string;
}

/** Stable requirement ids, derived from Blueprint ids rather than counters. */
export function componentRequirementId(blueprintComponentId: string): string {
  return `requirement:component:${blueprintComponentId}`;
}

export function instanceRequirementId(blueprintComponentId: string, elementId: string): string {
  return `requirement:instance:${blueprintComponentId}:${elementId}`;
}

export function regionRequirementId(regionId: string): string {
  return `requirement:region:${regionId}`;
}

export const SCREEN_REACHABILITY_REQUIREMENT_ID = "requirement:screen:reachability";

export function assetRequirementId(assetId: string): string {
  return `requirement:asset:${assetId}`;
}

/** What an instance demands of whatever component realizes it. */
function instanceDemands(instance: UIBlueprint["components"][number]["instances"][number]): string[] {
  const demands: string[] = [];
  const texts = instance.contents.map((slot) => slot.text).filter((text): text is string => text !== undefined);
  if (texts.length > 0) demands.push(`content: ${texts.slice(0, 4).join(" / ")}`);
  const slots = instance.contents
    .filter((slot) => slot.text === undefined && slot.name !== undefined)
    .map((slot) => slot.name!);
  if (slots.length > 0) demands.push(`slots: ${[...new Set(slots)].slice(0, 6).join(", ")}`);
  for (const [property, value] of Object.entries(instance.propertyValues ?? {})) {
    demands.push(`property ${property}=${value}`);
  }
  for (const difference of instance.differences.slice(0, 4)) demands.push(`differs: ${difference}`);
  return demands.slice(0, 24);
}

function componentDemands(component: UIBlueprint["components"][number]): string[] {
  const demands: string[] = [];
  if (component.sharedFacts.widthPx !== undefined && component.sharedFacts.heightPx !== undefined) {
    demands.push(`size ${component.sharedFacts.widthPx}x${component.sharedFacts.heightPx}`);
  }
  if (component.sharedFacts.style?.background !== undefined) demands.push(`background ${component.sharedFacts.style.background}`);
  if (component.sharedFacts.style?.border !== undefined) demands.push(`border ${component.sharedFacts.style.border}`);
  if (component.sharedFacts.style?.radiusPx !== undefined) demands.push(`radius ${component.sharedFacts.style.radiusPx}px`);
  if (component.anatomy.length > 0) {
    demands.push(`anatomy: ${component.anatomy.slice(0, 6).map((entry) => entry.name).join(", ")}`);
  }
  for (const property of component.properties.slice(0, 6)) {
    demands.push(`property ${property.name}: ${property.values.join("|")}`);
  }
  if (component.semantics.role !== undefined) demands.push(`role ${component.semantics.role}`);
  return demands.slice(0, 24);
}

/**
 * Compiles the deterministic skeleton.
 *
 * Same Blueprint and ProjectContext in, byte-identical draft out. No model,
 * no filesystem, no clock.
 */
export function compileImplementationMapDraft(
  blueprint: UIBlueprint,
  context: CanonicalProjectContext,
  options: CompileDraftOptions = {},
): ImplementationMapDraft {
  const requirements: MappingRequirement[] = [];
  const candidateSets: CandidateSet[] = [];
  const bounds: MappingBound[] = [];

  // 1. One requirement per design component, plus one per observed instance.
  for (const component of blueprint.components) {
    const definitionId = componentRequirementId(component.id);
    requirements.push({
      id: definitionId,
      kind: "component-definition",
      label: component.name,
      blueprintRef: component.id,
      demands: componentDemands(component),
      required: true,
    });
    candidateSets.push(buildComponentCandidates(definitionId, component.name, context));

    for (const instance of component.instances) {
      requirements.push({
        id: instanceRequirementId(component.id, instance.elementId),
        kind: "component-instance",
        label: instance.name ?? instance.elementId,
        blueprintRef: instance.elementId,
        parentRequirementId: definitionId,
        demands: instanceDemands(instance),
        required: true,
      });
    }
  }

  // 2. One requirement per semantic region, or per top-level container when
  //    semantic enrichment never ran — the design still has to be realized.
  const regions =
    blueprint.semanticRegions.length > 0
      ? blueprint.semanticRegions.map((region) => ({ id: region.id, label: region.name, ref: region.anchorElementId ?? region.id }))
      : blueprint.elements
          .filter((element) => element.parentId === blueprint.screen.rootElementId)
          .sort((left, right) => left.order - right.order)
          .map((element) => ({ id: element.id, label: element.facts.name ?? element.id, ref: element.id }));

  for (const region of regions) {
    requirements.push({
      id: regionRequirementId(region.id),
      kind: "region",
      label: region.label,
      blueprintRef: region.ref,
      demands: [],
      required: true,
    });
  }

  // 3. The screen has to be reachable. This requirement is why a run cannot
  //    end with components that exist and a page nobody can open.
  requirements.push({
    id: SCREEN_REACHABILITY_REQUIREMENT_ID,
    kind: "screen-reachability",
    label: blueprint.screen.name,
    blueprintRef: blueprint.screen.rootElementId,
    demands: [
      ...(blueprint.screen.widthPx !== undefined && blueprint.screen.heightPx !== undefined
        ? [`screen ${blueprint.screen.widthPx}x${blueprint.screen.heightPx}`]
        : []),
      `routing ${context.routing.kind}`,
    ],
    required: true,
  });

  // 4. Assets.
  for (const asset of blueprint.assets) {
    requirements.push({
      id: assetRequirementId(asset.id),
      kind: "asset",
      label: asset.name,
      blueprintRef: asset.id,
      demands: [`type ${asset.type}`],
      required: false,
    });
  }

  const retained = requirements.slice(0, MAX_REQUIREMENTS);
  if (requirements.length > MAX_REQUIREMENTS) {
    bounds.push({
      collection: "requirements",
      discoveredCount: requirements.length,
      retainedCount: retained.length,
      limit: MAX_REQUIREMENTS,
      truncated: true,
      selectionRule: "Blueprint order: component definitions and instances, then regions, screen reachability, assets",
    });
  }
  const retainedIds = new Set(retained.map((requirement) => requirement.id));

  for (const set of candidateSets) {
    if (set.bound !== undefined) bounds.push(set.bound);
  }

  const destinationCandidates = [
    ...context.destinations.map((destination, index) => ({
      id: `destination-${index + 1}`,
      path: destination.path,
      kind: destination.kind,
      ...(destination.route !== undefined ? { route: destination.route } : {}),
      status: destination.status === "explicitly-selected" ? ("existing" as const) : destination.status,
      factConfidence: destination.provenance.confidence,
    })),
  ].slice(0, 32);

  const draft = {
    schemaVersion: IMPLEMENTATION_MAP_SCHEMA_VERSION,
    binding: {
      ...(options.blueprintArtifactId !== undefined ? { blueprintArtifactId: options.blueprintArtifactId } : {}),
      blueprintCompilerVersion: blueprint.provenance.compilerVersion,
      blueprintScreenNodeId: blueprint.screen.rootElementId,
      blueprintSemanticStatus: blueprint.semanticEnrichment.status,
      ...(options.projectContextArtifactId !== undefined
        ? { projectContextArtifactId: options.projectContextArtifactId }
        : {}),
      projectContextCompilerVersion: context.provenance.compilerVersion,
      projectRootIdentity: context.project.rootIdentity,
      ...(context.project.contextFingerprint !== undefined
        ? { projectFingerprint: context.project.contextFingerprint }
        : {}),
    },
    requirements: retained,
    candidates: candidateSets
      .filter((set) => retainedIds.has(set.requirementId))
      .map((set) => ({
        requirementId: set.requirementId,
        candidates: [...set.candidates],
        ...(set.bound !== undefined ? { bound: set.bound } : {}),
      })),
    destinationCandidates,
    plannedDirectories: plannedDirectoriesFor(context),
    projectTokens: projectTokensFor(context),
    projectAssets: projectAssetsFor(context),
    bounds,
    provenance: { compilerVersion: IMPLEMENTATION_MAP_COMPILER_VERSION },
  };

  return implementationMapDraftSchema.parse(draft);
}
