// packages/core/src/reconciliation/comparison.ts
import type { ArtifactRef, ArtifactRegistry } from "@designflow/sdk";
import { contentEquals } from "../artifacts";

/**
 * An artifact reference paired with the version it identifies.
 *
 * Reconciliation identity is `id + version`. The version comes from the
 * reference when it names one, and from the registry otherwise.
 */
export interface VersionedArtifact {
  readonly ref: ArtifactRef;
  readonly version: number;
}

/** Stable key for `id + version`. */
export function identityOf(artifact: VersionedArtifact): string {
  return `${artifact.ref.id}@${artifact.version}`;
}

/**
 * Pairs each reference with the version it identifies.
 *
 * A reference that names its own version is taken at its word — that is the
 * revision it meant, and for an artifact recorded by a past run the registry's
 * current version is a different thing entirely. Only an unversioned reference
 * falls back to the registry.
 *
 * An id the registry does not know, and which names no version of its own, is
 * dropped rather than guessed at: it has no identity to reconcile against, and
 * inventing one would let unrelated references collide.
 */
export async function resolveVersions(
  registry: ArtifactRegistry,
  refs: readonly ArtifactRef[],
): Promise<readonly VersionedArtifact[]> {
  const resolved: VersionedArtifact[] = [];

  for (const ref of refs) {
    if (ref.version !== undefined) {
      resolved.push({ ref, version: ref.version });
      continue;
    }

    const artifact = await registry.getArtifact(ref.id);
    if (artifact === null) continue;

    resolved.push({ ref, version: artifact.version });
  }

  return resolved;
}

// ── Conflict Detection ──────────────────────────────────────────

export const RECONCILIATION_CONFLICT_KINDS = [
  /** The same `id + version` appears twice in the merged set. */
  "duplicate_identity",
  /** One id appears at two different versions in the merged set. */
  "ambiguous_version",
  /** A produced artifact reuses a prior identity with different content. */
  "content_conflict",
] as const;

export type ReconciliationConflictKind =
  (typeof RECONCILIATION_CONFLICT_KINDS)[number];

export interface ReconciliationConflict {
  readonly artifactId: string;
  readonly kind: ReconciliationConflictKind;
  readonly detail: string;
}

/**
 * Rejects a merged set that cannot describe one coherent state.
 *
 * Two shapes are refused. The same identity twice is redundant at best and
 * contradictory at worst. One id at two versions is worse: a dependent reading
 * the set cannot tell which revision it is meant to consume.
 */
export function findSetConflicts(
  merged: readonly VersionedArtifact[],
): readonly ReconciliationConflict[] {
  const conflicts: ReconciliationConflict[] = [];
  const seenIdentity = new Set<string>();
  const versionById = new Map<string, number>();

  for (const artifact of merged) {
    const identity = identityOf(artifact);

    if (seenIdentity.has(identity)) {
      conflicts.push({
        artifactId: artifact.ref.id,
        kind: "duplicate_identity",
        detail: `${identity} appears more than once`,
      });
      continue;
    }
    seenIdentity.add(identity);

    const existing = versionById.get(artifact.ref.id);

    if (existing !== undefined && existing !== artifact.version) {
      conflicts.push({
        artifactId: artifact.ref.id,
        kind: "ambiguous_version",
        detail: `Present at both version ${existing} and version ${artifact.version}`,
      });
      continue;
    }

    versionById.set(artifact.ref.id, artifact.version);
  }

  return conflicts;
}

/**
 * Rejects a produced artifact that claims a prior identity with new content.
 *
 * `id + version` is supposed to name one immutable thing. A node that ran
 * again and emitted the same version must have emitted the same artifact; if
 * its metadata differs, either the version should have advanced or the content
 * should not have.
 */
export function findContentConflicts(
  previous: readonly VersionedArtifact[],
  produced: readonly VersionedArtifact[],
): readonly ReconciliationConflict[] {
  const priorByIdentity = new Map<string, VersionedArtifact>();
  for (const artifact of previous) {
    priorByIdentity.set(identityOf(artifact), artifact);
  }

  const conflicts: ReconciliationConflict[] = [];

  for (const artifact of produced) {
    const prior = priorByIdentity.get(identityOf(artifact));
    if (prior === undefined) continue;

    if (!contentEquals(prior.ref.metadata, artifact.ref.metadata)) {
      conflicts.push({
        artifactId: artifact.ref.id,
        kind: "content_conflict",
        detail: `Version ${artifact.version} was produced with different metadata than the previous run recorded`,
      });
    }
  }

  return conflicts;
}
