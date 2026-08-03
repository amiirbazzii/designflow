// packages/core/src/reuse-resolver.ts
import {
  readChangedArtifacts,
  type ArtifactRegistry,
  type CapabilityReuseResolver,
  type ExecutionRepository,
  type WorkflowPackage,
} from "@designflow/sdk";
import { ArtifactIntelligenceService } from "./artifacts";

/** Metadata key the engine stamps onto every artifact it produces. See `engine.ts`. */
const REUSE_FINGERPRINT_METADATA_KEY = "reuseFingerprint";

export interface ArtifactFingerprintReuseResolverOptions {
  readonly workflows: ReadonlyMap<string, WorkflowPackage>;
  readonly artifactStore: ArtifactRegistry;
  readonly repository: ExecutionRepository;
}

/**
 * The reuse policy every DesignFlow host should use unless it has a specific
 * reason not to: reuse a node's prior output only when
 *
 * 1. the run's declared change set (if any) does not reach it, directly or
 *    through a dependency — the existing, explicit "I know what changed"
 *    signal a resume already relies on — **and**
 * 2. the artifact's stored reuse fingerprint matches the one this request
 *    would produce right now.
 *
 * (2) is what makes reuse safe when nothing declared a change set at all —
 * the ordinary case for a fresh, non-resumed run. The fingerprint the engine
 * stamps on every produced artifact (`ExecutionEngine.buildReuseFingerprint`)
 * already folds in the node's resolved input, its dependencies' versions, the
 * capability and workflow identity and version, a reuse-schema version, and
 * whatever reuse identity the host attached to the execution (project, model
 * profile, ...). A logical artifact id is shared across every run of a
 * workflow, on purpose — that is what makes "was this exact computation done
 * before, anywhere" answerable at all — so an id existing is no longer read
 * as "reuse it"; only an id existing *with a matching fingerprint* is.
 *
 * An artifact with no stored fingerprint at all — every artifact produced
 * before this resolver existed — never matches, by construction: `undefined`
 * cannot equal a fingerprint string. That is what makes pre-Stage-1 artifacts
 * safely non-reusable without a separate migration pass.
 */
export function createArtifactFingerprintReuseResolver(
  options: ArtifactFingerprintReuseResolverOptions,
): CapabilityReuseResolver {
  const { workflows, artifactStore, repository } = options;
  const intelligence = new ArtifactIntelligenceService({ registry: artifactStore });

  const declined = { reuse: false as const, artifacts: [] };

  return {
    async resolve(request) {
      const definition = workflows.get(request.workflowId)?.definition;
      const node = definition?.nodes.find(
        (candidate) =>
          "capabilityId" in candidate &&
          candidate.capabilityId === request.capabilityId,
      );

      const produces = node?.produces ?? [];
      if (produces.length === 0) return declined;

      const record = await repository.get(request.executionId);
      const changed = readChangedArtifacts(record?.metadata);

      // Everything the declared change set invalidates, directly or downstream.
      const affected = new Set<string>(changed);
      for (const artifactId of changed) {
        if ((await artifactStore.getArtifact(artifactId)) === null) continue;

        const impact = await intelligence.analyzeImpact(artifactId);
        for (const id of impact.affectedArtifacts) affected.add(id);
      }

      if (produces.some((id) => affected.has(id))) return declined;

      const artifacts = [];
      for (const artifactId of produces) {
        const artifact = await artifactStore.getArtifact(artifactId);
        // Nothing to reuse on a first run, or after a legacy artifact was
        // removed; the node runs normally.
        if (artifact === null) return declined;

        const storedFingerprint = artifact.metadata[REUSE_FINGERPRINT_METADATA_KEY];
        if (storedFingerprint !== request.inputFingerprint) return declined;

        artifacts.push({
          id: artifact.id,
          type: artifact.type,
          metadata: artifact.metadata,
        });
      }

      return {
        reuse: true,
        artifacts,
        reason: "unaffected by the change set, and identity unchanged",
      };
    },
  };
}
