// packages/core/src/artifacts/registry-support.ts
import type { ArtifactRegistry, ArtifactStore } from "@designflow/sdk";

/**
 * Reports whether a payload store also implements the artifact registry.
 *
 * The engine registers artifact identity, versions and provenance only when
 * the configured store can hold them; payload-only backends keep working
 * unchanged.
 */
export function isArtifactRegistry(
  store: ArtifactStore,
): store is ArtifactStore & ArtifactRegistry {
  if (!("createArtifact" in store)) return false;
  if (!("createVersion" in store)) return false;
  if (!("getArtifact" in store)) return false;
  if (!("getVersion" in store)) return false;
  if (!("addRelation" in store)) return false;
  if (!("getLineage" in store)) return false;

  return (
    typeof store.createArtifact === "function" &&
    typeof store.createVersion === "function" &&
    typeof store.getArtifact === "function" &&
    typeof store.getVersion === "function" &&
    typeof store.addRelation === "function" &&
    typeof store.getLineage === "function"
  );
}
