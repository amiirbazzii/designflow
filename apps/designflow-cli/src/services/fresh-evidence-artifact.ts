import {
  figmaSourceSnapshotSchema,
  type ArtifactRef,
  type RegistryArtifactStore,
} from "@designflow/sdk";
import type { FreshFrameEvidence } from "./fresh-figma-evidence";
import {
  createFreshBuilderEvidence,
  type FreshBuilderEvidenceProjection,
} from "./fresh-builder-evidence";

export const FRESH_AUTHORITATIVE_EVIDENCE_TYPE = "fresh.authoritative-evidence";

export interface FreshEvidenceIdentity {
  readonly nodeId: string;
  readonly fileKey?: string;
  readonly frameName?: string;
  readonly width?: number;
  readonly height?: number;
}

export class FreshEvidenceArtifactError extends Error {
  public readonly code = "ERR_FRESH_EVIDENCE_ARTIFACT";

  public constructor(message: string, public readonly metadata: Record<string, unknown> = {}) {
    super(message);
    this.name = "FreshEvidenceArtifactError";
    Object.setPrototypeOf(this, FreshEvidenceArtifactError.prototype);
  }
}

interface PersistedFreshEvidence {
  readonly schemaVersion: "1";
  readonly evidence: FreshFrameEvidence;
  readonly completeness: FreshBuilderEvidenceProjection["completeness"];
}

/** Saves only complete, authoritative Fresh evidence through the existing artifact store. */
export async function persistFreshAuthoritativeEvidence(
  store: RegistryArtifactStore,
  evidence: FreshFrameEvidence,
): Promise<ArtifactRef> {
  const projection = createFreshBuilderEvidence(evidence);
  const persisted: PersistedFreshEvidence = {
    schemaVersion: "1",
    evidence,
    completeness: projection.completeness,
  };
  return store.save(persisted, {
    type: FRESH_AUTHORITATIVE_EVIDENCE_TYPE,
    frameId: evidence.frame.id,
    frameName: evidence.frame.name,
    width: evidence.frame.width,
    height: evidence.frame.height,
    nodeCount: projection.metrics.nodeCount,
    visibleTextCount: projection.metrics.visibleTextCount,
    unresolvedVisibleInstanceCount: projection.metrics.unresolvedVisibleInstanceCount,
    completeness: "passed",
    sourceProvenance: evidence.snapshot.sourceProvenance,
    referenceScreenshotArtifactId: evidence.referenceScreenshot?.artifactId,
  });
}

/** Loads and revalidates one persisted Fresh evidence payload without contacting Figma. */
export async function loadFreshAuthoritativeEvidence(
  store: RegistryArtifactStore,
  artifactId: string,
  expected?: FreshEvidenceIdentity,
): Promise<FreshFrameEvidence> {
  const stored = await store.get(artifactId);
  if (stored === null) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence was not found.", { artifactId });
  }
  if (stored.artifact.metadata.type !== FRESH_AUTHORITATIVE_EVIDENCE_TYPE) {
    throw new FreshEvidenceArtifactError("Artifact is not authoritative Fresh evidence.", { artifactId });
  }

  const raw = stored.data as Partial<PersistedFreshEvidence>;
  if (raw.schemaVersion !== "1" || raw.evidence === undefined || raw.completeness?.complete !== true) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence is incomplete.", { artifactId });
  }
  const evidence = validatePersistedEvidence(raw.evidence);
  assertIdentity(evidence, expected, artifactId);
  const projection = createFreshBuilderEvidence(evidence);
  if (!projection.completeness.complete) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence no longer passes completeness validation.", {
      artifactId,
      completeness: projection.completeness,
    });
  }
  return evidence;
}

function validatePersistedEvidence(value: unknown): FreshFrameEvidence {
  if (typeof value !== "object" || value === null) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence has an invalid shape.");
  }
  const raw = value as Partial<FreshFrameEvidence>;
  if (
    raw.schemaVersion !== "1"
    || raw.frame === undefined
    || typeof raw.frame.id !== "string"
    || typeof raw.frame.name !== "string"
    || !Number.isFinite(raw.frame.width)
    || !Number.isFinite(raw.frame.height)
    || raw.snapshot === undefined
  ) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence is missing frame identity or dimensions.");
  }
  const snapshot = figmaSourceSnapshotSchema.parse(raw.snapshot);
  const resolvedFrames = snapshot.source.resolvedFrames;
  if (resolvedFrames.length !== 1 || resolvedFrames[0]?.id !== raw.frame.id) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence frame identity does not match its snapshot.", {
      frameId: raw.frame.id,
      resolvedNodeId: resolvedFrames[0]?.id,
    });
  }
  const node = snapshot.nodes.find((candidate) => candidate.id === raw.frame?.id);
  const bounds = node?.absoluteBoundingBox;
  if (bounds === undefined || bounds.width !== raw.frame.width || bounds.height !== raw.frame.height) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence dimensions do not match authoritative node bounds.", {
      frameId: raw.frame.id,
    });
  }
  return { ...raw, snapshot } as FreshFrameEvidence;
}

function assertIdentity(
  evidence: FreshFrameEvidence,
  expected: FreshEvidenceIdentity | undefined,
  artifactId: string,
): void {
  if (expected === undefined) return;
  if (
    evidence.frame.id !== expected.nodeId
    || (expected.fileKey !== undefined && evidence.snapshot.source.fileKey !== expected.fileKey)
    || (expected.frameName !== undefined && evidence.frame.name !== expected.frameName)
    || (expected.width !== undefined && evidence.frame.width !== expected.width)
    || (expected.height !== undefined && evidence.frame.height !== expected.height)
  ) {
    throw new FreshEvidenceArtifactError("Persisted Fresh evidence does not match the requested frame identity.", {
      artifactId,
      expected,
      actual: evidence.frame,
    });
  }
}
