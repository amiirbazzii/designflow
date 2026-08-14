// packages/agents/src/ui-builder/builder-evidence-compiler.ts
//
// The model-facing view of one build.
//
// Three canonical artifacts go in — the Blueprint (design truth), the
// Implementation Map (the decisions) and the ProjectContext (project truth) —
// and what comes out is the smallest thing that can produce correct code for
// *this plan*: the design requirements it must realize, the decisions it must
// obey, the project conventions it must match, and the few source files the
// host selected from the map itself.
//
// Deliberately absent: the repository inventory, raw Figma transport, the
// legacy prose Specification, and any file the plan does not name.
import type {
  CanonicalProjectContext,
  ImplementationMap,
  UIBlueprint,
} from "@designflow/sdk";

import {
  boundExcerpt,
  selectBuilderSourcePaths,
  allowedWritePaths,
  type BuilderSourceExcerpt,
} from "./builder-source-selection";

export interface BuilderEvidenceBundle {
  readonly mode: "initial" | "visual_repair";
  readonly design: unknown;
  readonly decisions: unknown;
  readonly project: unknown;
  readonly sources: unknown;
  readonly constraints: unknown;
  readonly repair?: unknown;
  /** Bounded measured visual mismatches, present only in `visual_repair` mode. */
  readonly visualRepair?: unknown;
  readonly bytes: number;
  readonly relevantFileCount: number;
}

export interface CompileBuilderEvidenceOptions {
  readonly blueprint: UIBlueprint;
  readonly map: ImplementationMap;
  readonly context: CanonicalProjectContext;
  /** Contents the host read for the map-selected paths. */
  readonly sourceExcerpts?: readonly BuilderSourceExcerpt[];
  /** Bounded deterministic findings from a previous attempt. */
  readonly repairFeedback?: unknown;
  readonly mode?: "initial" | "visual_repair";
  /**
   * Host-compiled visual repair evidence: measured mismatches, allowed
   * implementation targets, and clearly separated advisory Critic context.
   * Never raw reports, screenshots, logs or previous conversations.
   */
  readonly visualRepairEvidence?: unknown;
}

function encodedLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Compiles the bounded build request. Deterministic for identical inputs. */
export function compileUIBuilderEvidence(options: CompileBuilderEvidenceOptions): BuilderEvidenceBundle {
  const { blueprint, map, context } = options;
  const selected = selectBuilderSourcePaths(map);
  const excerptByPath = new Map((options.sourceExcerpts ?? []).map((excerpt) => [excerpt.path, excerpt]));

  const requirementById = new Map(map.requirements.map((requirement) => [requirement.id, requirement]));

  const design = {
    screen: {
      name: blueprint.screen.name,
      widthPx: blueprint.screen.widthPx,
      heightPx: blueprint.screen.heightPx,
      background: blueprint.screen.background,
    },
    regions: blueprint.semanticRegions.map((region) => ({
      name: region.name,
      order: region.order,
      role: region.semantics.role,
      memberElementIds: region.memberElementIds.slice(0, 24),
    })),
    components: blueprint.components.map((component) => ({
      id: component.id,
      name: component.name,
      sharedFacts: component.sharedFacts,
      anatomy: component.anatomy.slice(0, 12),
      instances: component.instances.map((instance) => ({
        elementId: instance.elementId,
        name: instance.name,
        propertyValues: instance.propertyValues,
        contents: instance.contents.map((slot) => ({ name: slot.name, text: slot.text })),
      })),
    })),
    elements: blueprint.elements
      .filter((element) => element.facts.text !== undefined || element.facts.componentRef !== undefined)
      .map((element) => ({
        id: element.id,
        parentId: element.parentId,
        order: element.order,
        name: element.facts.name,
        text: element.facts.text,
        size: element.facts.widthPx !== undefined ? `${element.facts.widthPx}x${element.facts.heightPx ?? "?"}` : undefined,
        style: element.facts.style,
        typography: element.facts.typography,
        role: element.semantics.role,
      })),
    assets: blueprint.assets,
  };

  const decisions = {
    destination: map.screen?.destination,
    compositionRootPath: map.screen?.compositionRootPath,
    components: map.components.map((component) => ({
      requirementId: component.requirementId,
      label: requirementById.get(component.requirementId)?.label,
      blueprintComponentId: component.blueprintComponentId,
      action: component.action,
      projectTarget: component.projectTarget,
      plannedPath: component.plannedPath,
      requiredAdaptations: component.requiredAdaptations,
    })),
    styles: map.styles,
    assets: map.assets,
    composition: map.composition,
  };

  const project = {
    framework: context.runtime.framework?.value,
    language: context.runtime.language?.value,
    routing: context.routing.kind,
    routeFileConvention: context.routing.routeFileConvention,
    stylingStrategies: context.styling.strategies,
    aliases: context.structure.aliases.map((alias) => ({ pattern: alias.pattern, targets: alias.targets })),
    conventions: context.conventions.map((convention) => `${convention.kind}: ${convention.value}`),
    dependencies: context.runtime.dependencies.slice(0, 60),
  };

  const sources = selected.map((entry) => {
    const excerpt = excerptByPath.get(entry.path);
    const bounded = excerpt === undefined ? undefined : boundExcerpt(excerpt.content);
    return {
      path: entry.path,
      reason: entry.reason,
      writable: entry.writable,
      ...(bounded !== undefined ? { content: bounded.text, truncated: bounded.truncated } : { content: null }),
    };
  });

  const constraints = {
    // The single most load-bearing sentence in the request: these are the
    // only files a proposal may write, and the host rejects anything else.
    allowedWritePaths: allowedWritePaths(map),
    readOnlyPaths: selected.filter((entry) => !entry.writable).map((entry) => entry.path),
    projectId: context.project.projectId,
    projectFingerprint: map.binding.projectFingerprint,
  };

  const bundle = {
    mode: options.mode ?? ("initial" as const),
    design,
    decisions,
    project,
    sources,
    constraints,
    ...(options.repairFeedback !== undefined ? { repair: options.repairFeedback } : {}),
    ...(options.visualRepairEvidence !== undefined ? { visualRepair: options.visualRepairEvidence } : {}),
  };

  return {
    ...bundle,
    bytes: encodedLength(bundle),
    relevantFileCount: selected.length,
  };
}
