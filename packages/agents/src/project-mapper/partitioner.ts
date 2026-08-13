// packages/agents/src/project-mapper/partitioner.ts
//
// Deterministic partitioning of a mapping draft into bounded requests.
//
// The same discipline the Design Interpreter established: never one enormous
// call. Mapping splits along the stages the decisions actually depend on —
// the destination first, then component families, then foundations, then the
// composition that arranges what the earlier stages decided.
//
// A partition carries only the requirements it decides and the candidates
// offered for them. It never carries the whole project inventory, and it
// never carries a requirement another partition owns.
import type { ImplementationMapDraft } from "@designflow/sdk";

/** Component requirements per request. Small enough to reason about. */
export const MAX_COMPONENTS_PER_PARTITION = 6;
export const MAX_MAPPING_PARTITION_BYTES = 24_000;

export type MappingStage = "destination" | "components" | "foundations" | "composition";

export interface MappingPartition {
  readonly id: string;
  readonly stage: MappingStage;
  readonly title: string;
  /** The only requirement ids a patch answering this partition may decide. */
  readonly requirementIds: readonly string[];
  /** The only candidate ids it may select. */
  readonly candidateIds: readonly string[];
  readonly serializedBytes: number;
}

function encodedLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push([...items.slice(index, index + size)]);
  return chunks;
}

/**
 * Partitions a draft into ordered mapping requests.
 *
 * Order is the dependency order: composition comes last because it arranges
 * decisions the component stage has already made, and a later stage that
 * disagrees with an earlier one produces a typed conflict at merge rather
 * than silently overriding it.
 */
export function partitionMappingDraft(draft: ImplementationMapDraft): readonly MappingPartition[] {
  const partitions: MappingPartition[] = [];
  const candidatesByRequirement = new Map(draft.candidates.map((set) => [set.requirementId, set.candidates]));

  const screenRequirement = draft.requirements.find((requirement) => requirement.kind === "screen-reachability");
  if (screenRequirement !== undefined) {
    partitions.push({
      id: "mapping:destination",
      stage: "destination",
      title: screenRequirement.label,
      requirementIds: [screenRequirement.id],
      candidateIds: draft.destinationCandidates.map((candidate) => candidate.id),
      serializedBytes: encodedLength({ requirement: screenRequirement, destinations: draft.destinationCandidates }),
    });
  }

  const definitions = draft.requirements.filter((requirement) => requirement.kind === "component-definition");
  const instancesByParent = new Map<string, typeof draft.requirements>();
  for (const requirement of draft.requirements) {
    if (requirement.kind !== "component-instance" || requirement.parentRequirementId === undefined) continue;
    instancesByParent.set(requirement.parentRequirementId, [
      ...(instancesByParent.get(requirement.parentRequirementId) ?? []),
      requirement,
    ]);
  }

  chunk(definitions, MAX_COMPONENTS_PER_PARTITION).forEach((group, index) => {
    const requirementIds = group.flatMap((definition) => [
      definition.id,
      ...(instancesByParent.get(definition.id) ?? []).map((instance) => instance.id),
    ]);
    const candidateIds = group.flatMap((definition) =>
      (candidatesByRequirement.get(definition.id) ?? []).map((candidate) => candidate.id),
    );
    partitions.push({
      id: `mapping:components#${index + 1}`,
      stage: "components",
      title: group.map((definition) => definition.label).join(", "),
      requirementIds,
      candidateIds,
      serializedBytes: encodedLength({
        requirements: group,
        instances: group.flatMap((definition) => instancesByParent.get(definition.id) ?? []),
        candidates: group.map((definition) => candidatesByRequirement.get(definition.id) ?? []),
      }),
    });
  });

  const assetRequirements = draft.requirements.filter((requirement) => requirement.kind === "asset");
  if (draft.projectTokens.length > 0 || assetRequirements.length > 0) {
    partitions.push({
      id: "mapping:foundations",
      stage: "foundations",
      title: "design foundations and assets",
      requirementIds: assetRequirements.map((requirement) => requirement.id),
      candidateIds: [
        ...draft.projectTokens.map((token) => token.id),
        ...draft.projectAssets.map((asset) => asset.id),
      ],
      serializedBytes: encodedLength({ tokens: draft.projectTokens, assets: draft.projectAssets, requirements: assetRequirements }),
    });
  }

  const regionRequirements = draft.requirements.filter((requirement) => requirement.kind === "region");
  if (regionRequirements.length > 0) {
    partitions.push({
      id: "mapping:composition",
      stage: "composition",
      title: "screen composition",
      requirementIds: regionRequirements.map((requirement) => requirement.id),
      candidateIds: [],
      serializedBytes: encodedLength({ regions: regionRequirements }),
    });
  }

  return partitions;
}
