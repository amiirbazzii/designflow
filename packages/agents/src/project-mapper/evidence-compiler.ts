// packages/agents/src/project-mapper/evidence-compiler.ts
//
// The model-facing view of one mapping partition.
//
// Not a third source of truth: everything here is copied from the Blueprint,
// the ProjectContext or the draft, and every entity keeps the id it has in
// those artifacts so a decision can be traced straight back. What it does is
// keep the request small and relevant — the design facts needed to judge
// compatibility, the project facts needed to pick a target, and nothing else.
//
// Explicitly excluded: file contents, the wider repository inventory, raw
// Figma transport, environment values, and any project fact the partition's
// requirements do not touch.
import type {
  CanonicalProjectContext,
  ImplementationMapDraft,
  UIBlueprint,
} from "@designflow/sdk";

import type { MappingPartition } from "./partitioner";

export interface MappingEvidenceBundle {
  readonly partitionId: string;
  readonly stage: MappingPartition["stage"];
  readonly design: unknown;
  readonly project: unknown;
  readonly decide: unknown;
  readonly bytes: number;
}

function encodedLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Compiles the bounded evidence for one partition.
 *
 * `decide` is the shape of the answer: the requirement ids that need a
 * decision and, for each, the candidate ids that may be chosen. Stating it
 * explicitly is what makes "select among these" a smaller ask than "plan the
 * implementation".
 */
export function compileMappingEvidence(
  partition: MappingPartition,
  draft: ImplementationMapDraft,
  blueprint: UIBlueprint,
  context: CanonicalProjectContext,
): MappingEvidenceBundle {
  const requirementIds = new Set(partition.requirementIds);
  const requirements = draft.requirements.filter((requirement) => requirementIds.has(requirement.id));
  const candidateSets = draft.candidates.filter((set) => requirementIds.has(set.requirementId));

  const design =
    partition.stage === "foundations"
      ? {
          foundations: blueprint.foundations,
          assets: blueprint.assets.map((asset) => ({ id: asset.id, name: asset.name, type: asset.type })),
        }
      : partition.stage === "composition"
        ? {
            screen: { name: blueprint.screen.name, rootElementId: blueprint.screen.rootElementId },
            regions: blueprint.semanticRegions.map((region) => ({
              id: region.id,
              name: region.name,
              order: region.order,
              memberElementIds: region.memberElementIds.slice(0, 24),
              role: region.semantics.role,
            })),
          }
        : {
            screen: {
              name: blueprint.screen.name,
              widthPx: blueprint.screen.widthPx,
              heightPx: blueprint.screen.heightPx,
            },
            requirements: requirements.map((requirement) => ({
              id: requirement.id,
              kind: requirement.kind,
              label: requirement.label,
              parentRequirementId: requirement.parentRequirementId,
              demands: requirement.demands,
            })),
          };

  const project =
    partition.stage === "destination"
      ? {
          framework: context.runtime.framework?.value,
          routing: context.routing.kind,
          routeFileConvention: context.routing.routeFileConvention,
          sourceRoots: context.structure.sourceRoots,
          destinations: draft.destinationCandidates,
        }
      : partition.stage === "foundations"
        ? {
            stylingStrategies: context.styling.strategies,
            tokens: draft.projectTokens,
            assets: draft.projectAssets,
          }
        : partition.stage === "composition"
          ? { framework: context.runtime.framework?.value, routing: context.routing.kind }
          : {
              framework: context.runtime.framework?.value,
              designSystemPackages: context.designSystem.packages.map((entry) => entry.value),
              designSystemDirectories: context.designSystem.directories.map((entry) => ({
                path: entry.value,
                // Heuristic project facts stay marked as heuristic here too, so
                // a mapper never treats a guessed directory as certainty.
                confidence: entry.provenance.confidence,
              })),
              plannedDirectories: draft.plannedDirectories,
              candidates: candidateSets.map((set) => ({
                requirementId: set.requirementId,
                candidates: set.candidates.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                  path: candidate.path,
                  exportName: candidate.exportName,
                  props: context.components.find((component) => component.path === candidate.path)?.props.slice(0, 12) ?? [],
                  designSystemMember: candidate.designSystemMember,
                  matchReason: candidate.matchReason,
                  factConfidence: candidate.factConfidence,
                })),
                ...(set.bound !== undefined ? { candidateBound: set.bound } : {}),
              })),
            };

  const decide = {
    requirementIds: partition.requirementIds,
    candidateIds: partition.candidateIds,
  };

  return {
    partitionId: partition.id,
    stage: partition.stage,
    design,
    project,
    decide,
    bytes: encodedLength({ design, project, decide }),
  };
}
