import { z } from "zod";
import type { ArtifactRegistry } from "./artifact-system";
import { artifactRefSchema } from "./schemas";

// ── Dependencies ─────────────────────────────────────────────────

export const artifactDependencySchema = z.object({
  artifactId: z.string().min(1),
  /** Ids this artifact was built from, transitively, nearest first. */
  dependencies: z.array(z.string().min(1)),
  /** Ids built from this artifact, transitively, nearest first. */
  dependents: z.array(z.string().min(1)),
});

export type ArtifactDependency = z.infer<typeof artifactDependencySchema>;

// ── Impact ───────────────────────────────────────────────────────

export const artifactImpactSchema = z.object({
  artifactId: z.string().min(1),
  /** Everything downstream that a change to this artifact invalidates. */
  affectedArtifacts: z.array(z.string().min(1)),
  /** Workflows that produced any affected artifact, via provenance. */
  affectedWorkflows: z.array(z.string().min(1)),
  /** Executions that produced any affected artifact, via provenance. */
  affectedExecutions: z.array(z.string().min(1)),
});

export type ArtifactImpact = z.infer<typeof artifactImpactSchema>;

// ── Diff ─────────────────────────────────────────────────────────

export const artifactMetadataChangesSchema = z.object({
  /** Keys present in `toVersion` only. */
  added: z.array(z.string()),
  /** Keys present in `fromVersion` only. */
  removed: z.array(z.string()),
  /** Keys in both whose value changed. */
  modified: z.array(z.string()),
});

export type ArtifactMetadataChanges = z.infer<
  typeof artifactMetadataChangesSchema
>;

export const artifactDiffSchema = z.object({
  artifactId: z.string().min(1),
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  changed: z.boolean(),
  metadataChanges: artifactMetadataChangesSchema.optional(),
});

export type ArtifactDiff = z.infer<typeof artifactDiffSchema>;

// ── Reuse ────────────────────────────────────────────────────────

/**
 * An artifact at a version the caller previously observed.
 *
 * Reuse is only decidable against a known version — "same id" alone cannot
 * distinguish an unchanged artifact from one that has since been revised.
 * Omit `version` to ask only whether the artifact still exists.
 */
export const artifactVersionRefSchema = z.object({
  artifactId: z.string().min(1),
  version: z.number().int().positive().optional(),
});

export type ArtifactVersionRef = z.infer<typeof artifactVersionRefSchema>;

export const artifactReuseReasonSchema = z.enum([
  /** Registered and still at the observed version. */
  "unchanged",
  /** Not registered at all. */
  "missing",
  /** Registered, but has advanced past the observed version. */
  "version_changed",
]);

export type ArtifactReuseReason = z.infer<typeof artifactReuseReasonSchema>;

export const artifactReuseCandidateSchema = z.object({
  artifactId: z.string().min(1),
  /** The version currently registered, absent when the artifact is missing. */
  currentVersion: z.number().int().positive().optional(),
  /** The version the caller asked about, if it supplied one. */
  requestedVersion: z.number().int().positive().optional(),
  reusable: z.boolean(),
  reason: artifactReuseReasonSchema,
});

export type ArtifactReuseCandidate = z.infer<
  typeof artifactReuseCandidateSchema
>;

export const artifactReuseReportSchema = z.object({
  candidates: z.array(artifactReuseCandidateSchema),
  /** Ids of every reusable candidate, in request order. */
  reusable: z.array(z.string().min(1)),
  /** True when every requested artifact is reusable. */
  allReusable: z.boolean(),
});

export type ArtifactReuseReport = z.infer<typeof artifactReuseReportSchema>;

// ── Artifact Intelligence Contract ───────────────────────────────

/**
 * Read-only analysis over a registry's lineage graph.
 *
 * Every method is derived state — nothing here mutates the registry, so an
 * implementation may be layered over any `ArtifactRegistry`.
 */
export interface ArtifactIntelligence {
  getDependencies(artifactId: string): Promise<ArtifactDependency>;

  getDependents(artifactId: string): Promise<ArtifactDependency>;

  analyzeImpact(artifactId: string, version?: number): Promise<ArtifactImpact>;

  diffVersions(
    artifactId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<ArtifactDiff>;

  findReusableArtifacts(
    artifactIds: readonly ArtifactVersionRef[],
  ): Promise<ArtifactReuseReport>;
}

/**
 * A registry that also answers intelligence queries.
 *
 * Extension rather than widening, for the same reason as
 * `RegistryArtifactStore`: a registry that only stores lineage stays valid,
 * and analysis can be layered over it by composition.
 */
export interface IntelligentArtifactRegistry
  extends ArtifactRegistry,
    ArtifactIntelligence {}

// ── Capability Reuse Decision Boundary ───────────────────────────

/**
 * What the engine knows before running a capability, offered to a resolver so
 * it can decide whether the work has already been done.
 */
export interface CapabilityReuseRequest {
  readonly executionId: string;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly capabilityId: string;
  /** Content fingerprint of the node's resolved input. */
  readonly inputFingerprint: string;
  /** The artifacts this node would consume, at their current versions. */
  readonly dependencies: readonly ArtifactVersionRef[];
}

export const capabilityReuseDecisionSchema = z.object({
  reuse: z.boolean(),
  /** Artifacts to adopt as this node's output when `reuse` is true. */
  artifacts: z.array(artifactRefSchema).default([]),
  reason: z.string().optional(),
});

export type CapabilityReuseDecision = z.infer<
  typeof capabilityReuseDecisionSchema
>;

/**
 * The cache decision boundary.
 *
 * Core deliberately ships no implementation: deciding what may be reused, and
 * where prior outputs are stored, is a caching policy that belongs to the
 * host. Core only asks the question and honours the answer.
 */
export interface CapabilityReuseResolver {
  resolve(request: CapabilityReuseRequest): Promise<CapabilityReuseDecision>;
}
