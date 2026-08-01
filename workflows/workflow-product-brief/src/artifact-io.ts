// workflows/workflow-product-brief/src/artifact-io.ts
import { z } from "zod";
import { DesignFlowError } from "@designflow/sdk";
import type { ArtifactRef, CapabilityContext } from "@designflow/sdk";
import type { CapabilityOutput } from "./types";

/**
 * Reading and writing the artifacts that carry data between nodes.
 *
 * Capabilities in this workflow never receive an upstream value as an
 * argument. They look up the artifact they depend on, load its payload, and
 * write their own — so the dependency is visible in the lineage graph and a
 * node can be skipped and its output adopted without anything else changing.
 */

/** Metadata key under which a logical artifact points at its stored payload. */
const PAYLOAD_ID_KEY = "payloadId";

export class MissingUpstreamArtifactError extends DesignFlowError {
  public constructor(artifactId: string, capabilityId: string) {
    super(
      "ERR_MISSING_UPSTREAM_ARTIFACT",
      `Capability ${capabilityId} requires artifact ${artifactId}, which is not available`,
      { artifactId, capabilityId },
    );
    this.name = "MissingUpstreamArtifactError";
    Object.setPrototypeOf(this, MissingUpstreamArtifactError.prototype);
  }
}

/**
 * Stores a payload and returns a reference under a stable logical id.
 *
 * Two identities are in play. `save` content-addresses the payload, which is
 * what makes an unchanged payload cheap to store twice. The returned reference
 * carries the *logical* id instead, because that is what incremental planning
 * and artifact versioning need to reason about across runs.
 *
 * `summary` becomes the reference's metadata, and the engine compares it to
 * decide whether a re-emission is a new version. It must therefore be derived
 * only from the payload — anything incidental, a timestamp above all, would
 * make every run look like a change and defeat reuse entirely.
 */
export async function writeArtifact(
  context: CapabilityContext,
  options: {
    readonly artifactId: string;
    readonly artifactType: string;
    readonly name: string;
    readonly payload: unknown;
    readonly summary: Record<string, unknown>;
  },
): Promise<CapabilityOutput> {
  const stored = await context.artifactStore.save(options.payload, {
    type: options.artifactType,
    artifactId: options.artifactId,
  });

  return {
    artifactRef: {
      id: options.artifactId,
      type: options.artifactType,
      metadata: {
        name: options.name,
        ...options.summary,
        [PAYLOAD_ID_KEY]: stored.id,
      },
    },
  };
}

/**
 * Loads and validates the payload behind an upstream artifact.
 *
 * Looks the artifact up among the ones this node depends on, follows its
 * metadata to the stored payload, and parses it. A reference the engine
 * adopted from a previous run resolves exactly like a freshly produced one,
 * which is what makes a skipped upstream node invisible here.
 */
export async function readArtifact<T>(
  context: CapabilityContext,
  artifactId: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const ref = findArtifact(context.parentArtifacts, artifactId);

  if (ref === undefined) {
    throw new MissingUpstreamArtifactError(artifactId, context.capabilityId);
  }

  const payloadId = ref.metadata[PAYLOAD_ID_KEY];

  if (typeof payloadId !== "string" || payloadId.length === 0) {
    throw new DesignFlowError(
      "ERR_ARTIFACT_PAYLOAD_MISSING",
      `Artifact ${artifactId} carries no payload reference`,
      { artifactId, capabilityId: context.capabilityId },
    );
  }

  const loaded = await context.artifactStore.get(payloadId);

  if (loaded === null) {
    throw new DesignFlowError(
      "ERR_ARTIFACT_PAYLOAD_MISSING",
      `Payload ${payloadId} for artifact ${artifactId} is no longer stored`,
      { artifactId, payloadId, capabilityId: context.capabilityId },
    );
  }

  return schema.parse(loaded.data);
}

/** The most recent reference to a logical artifact among a node's inputs. */
function findArtifact(
  artifacts: readonly ArtifactRef[],
  artifactId: string,
): ArtifactRef | undefined {
  for (let index = artifacts.length - 1; index >= 0; index--) {
    const ref = artifacts[index];
    if (ref?.id === artifactId) return ref;
  }

  return undefined;
}
