import type { ArtifactRelationType } from "@designflow/sdk";

/**
 * Relations that describe where an artifact came from. Together they form one
 * lineage graph, so a cycle across any mix of them is still a cycle, and a
 * dependency walk must follow all of them.
 */
export const LINEAGE_RELATIONS: ReadonlySet<ArtifactRelationType> = new Set([
  "derived_from",
  "generated_from",
  "validated_by",
]);

export function isLineageRelation(relation: ArtifactRelationType): boolean {
  return LINEAGE_RELATIONS.has(relation);
}

/**
 * The relation types a proposed edge must be checked against for cycles.
 *
 * Lineage edges are checked against the whole lineage graph. `replaced_by`
 * is checked only against itself: "new derived_from old" alongside "old
 * replaced_by new" describes one supersession from both sides and must stay
 * legal, whereas a chain of supersessions folding back on itself must not.
 */
export function cycleScope(
  relation: ArtifactRelationType,
): ReadonlySet<ArtifactRelationType> {
  return LINEAGE_RELATIONS.has(relation)
    ? LINEAGE_RELATIONS
    : new Set<ArtifactRelationType>([relation]);
}
