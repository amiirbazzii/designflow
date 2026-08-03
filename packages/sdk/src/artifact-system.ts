// packages/sdk/src/artifact-system.ts
import { z } from "zod";

// ── Provenance ───────────────────────────────────────────────────

export const artifactProvenanceSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  capabilityId: z.string().min(1).optional(),
});

export type ArtifactProvenance = z.infer<typeof artifactProvenanceSchema>;

// ── Artifact ─────────────────────────────────────────────────────

export const artifactSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  /**
   * Pointer to the latest version. Starts at 1 and only ever increases; the
   * version *records* it points at are themselves immutable.
   */
  version: z.number().int().positive(),
  createdAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  provenance: artifactProvenanceSchema.optional(),
});

export type Artifact = z.infer<typeof artifactSchema>;

/**
 * What a caller supplies to register an artifact. Identity may be omitted and
 * assigned by the store; `version` and `createdAt` are always store-assigned.
 */
export const artifactInputSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  provenance: artifactProvenanceSchema.optional(),
});

export type ArtifactInput = z.infer<typeof artifactInputSchema>;

// ── Artifact Version ─────────────────────────────────────────────

export const artifactVersionSchema = z.object({
  artifactId: z.string().min(1),
  version: z.number().int().positive(),
  hash: z.string().min(1),
  createdAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

// ── Artifact Relations ───────────────────────────────────────────

export const artifactRelationTypeSchema = z.enum([
  "derived_from",
  "generated_from",
  "validated_by",
  "replaced_by",
]);

export type ArtifactRelationType = z.infer<typeof artifactRelationTypeSchema>;

/**
 * A directed edge from `sourceArtifactId` to `targetArtifactId`.
 *
 * Read source-first: "A derived_from B" means A points at its origin B, so
 * following edges forward walks toward ancestors.
 */
export const artifactRelationSchema = z.object({
  sourceArtifactId: z.string().min(1),
  targetArtifactId: z.string().min(1),
  relation: artifactRelationTypeSchema,
});

export type ArtifactRelation = z.infer<typeof artifactRelationSchema>;

// ── Lineage Graph ────────────────────────────────────────────────

export const artifactLineageGraphSchema = z.object({
  artifactId: z.string().min(1),
  /** Every artifact reachable from the subject, plus the subject itself. */
  nodes: z.array(artifactSchema),
  /** Every relation whose endpoints are both in `nodes`. */
  relations: z.array(artifactRelationSchema),
  /** Ids reachable by following edges forward, nearest first. */
  ancestors: z.array(z.string().min(1)),
  /** Ids reachable by following edges backward, nearest first. */
  descendants: z.array(z.string().min(1)),
});

export type ArtifactLineageGraph = z.infer<typeof artifactLineageGraphSchema>;

// ── Artifact Registry Contract ───────────────────────────────────

/**
 * Identity, immutable versioning, provenance and relationships for artifacts.
 *
 * Deliberately carries no payload operations: the bytes an artifact refers to
 * stay behind `ArtifactStore`, so a registry implementation never has to hold
 * large payloads. `RegistryArtifactStore` joins the two.
 */
export interface ArtifactRegistry {
  createArtifact(artifact: ArtifactInput): Promise<Artifact>;

  /**
   * `eventProvenance` attributes the `artifact.version_created` event this
   * emits to the execution actually doing the work, when it differs from the
   * artifact's own (immutable, first-creation) `provenance`. Without it, a
   * version bump is announced under the execution that first created the
   * artifact, which is wrong for every later run that revises it — and is
   * exactly what made a re-executed (not reused) node vanish from a report
   * built by scanning that execution's own events.
   */
  createVersion(
    artifactId: string,
    metadata?: Record<string, unknown>,
    eventProvenance?: ArtifactProvenance,
  ): Promise<ArtifactVersion>;

  getArtifact(id: string): Promise<Artifact | null>;

  getVersion(
    artifactId: string,
    version: number,
  ): Promise<ArtifactVersion | null>;

  addRelation(relation: ArtifactRelation): Promise<void>;

  getLineage(artifactId: string): Promise<ArtifactLineageGraph>;
}
