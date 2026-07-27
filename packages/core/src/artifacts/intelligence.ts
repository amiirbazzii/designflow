import {
  artifactDependencySchema,
  artifactDiffSchema,
  artifactImpactSchema,
  artifactReuseReportSchema,
  artifactVersionRefSchema,
  executionEventSchema,
} from "@designflow/sdk";
import type {
  Artifact,
  ArtifactDependency,
  ArtifactDiff,
  ArtifactImpact,
  ArtifactIntelligence,
  ArtifactLineageGraph,
  ArtifactMetadataChanges,
  ArtifactProvenance,
  ArtifactRegistry,
  ArtifactReuseCandidate,
  ArtifactReuseReport,
  ArtifactVersionRef,
  ExecutionEventPublisher,
  ExecutionEventType,
} from "@designflow/sdk";
import { ArtifactVersionNotFoundError } from "../errors";
import { contentEquals } from "./immutability";
import { isLineageRelation } from "./relations";

export interface ArtifactIntelligenceServiceOptions {
  readonly registry: ArtifactRegistry;
  /**
   * Receives `artifact.impact_analyzed` and `artifact.diff_created`. Both are
   * attributed to the execution named by the subject artifact's provenance;
   * an artifact registered outside any execution publishes nothing.
   */
  readonly eventPublisher?: ExecutionEventPublisher;
}

/**
 * Analysis layered over an `ArtifactRegistry`.
 *
 * Holds no state of its own: every answer is derived from the registry's
 * lineage graph on demand, so it can never disagree with the registry and
 * needs no invalidation.
 */
export class ArtifactIntelligenceService implements ArtifactIntelligence {
  private readonly registry: ArtifactRegistry;
  private readonly eventPublisher: ExecutionEventPublisher | undefined;

  public constructor(options: ArtifactIntelligenceServiceOptions) {
    this.registry = options.registry;
    this.eventPublisher = options.eventPublisher;
  }

  // ── Dependency queries ────────────────────────────────────────

  /**
   * What this artifact was built from, transitively.
   *
   * Directional: `dependents` is always empty. Ask `getDependents` for the
   * other direction — a query that answered both would make the two methods
   * indistinguishable and let a caller read the opposite of what it asked for.
   */
  public async getDependencies(artifactId: string): Promise<ArtifactDependency> {
    const graph = await this.registry.getLineage(artifactId);

    return artifactDependencySchema.parse({
      artifactId,
      dependencies: walk(graph, artifactId, "dependencies"),
      dependents: [],
    });
  }

  /** What was built from this artifact, transitively. `dependencies` is always empty. */
  public async getDependents(artifactId: string): Promise<ArtifactDependency> {
    const graph = await this.registry.getLineage(artifactId);

    return artifactDependencySchema.parse({
      artifactId,
      dependencies: [],
      dependents: walk(graph, artifactId, "dependents"),
    });
  }

  // ── Impact analysis ───────────────────────────────────────────

  public async analyzeImpact(
    artifactId: string,
    version?: number,
  ): Promise<ArtifactImpact> {
    const graph = await this.registry.getLineage(artifactId);

    // The subject's own version is validated when supplied so an impact
    // report can never be attributed to a revision that does not exist.
    if (version !== undefined) {
      const record = await this.registry.getVersion(artifactId, version);
      if (record === null) {
        throw new ArtifactVersionNotFoundError(artifactId, version, {
          operation: "analyzeImpact",
        });
      }
    }

    const affectedArtifacts = walk(graph, artifactId, "dependents");

    const workflows = new Set<string>();
    const executions = new Set<string>();
    const nodes = new Map<string, Artifact>(
      graph.nodes.map((node) => [node.id, node]),
    );

    // Provenance of the *affected* artifacts, not the subject: those are the
    // executions whose output a change here invalidates, so those are the
    // ones that need rerunning.
    for (const affectedId of affectedArtifacts) {
      const provenance = nodes.get(affectedId)?.provenance;
      if (provenance === undefined) continue;

      workflows.add(provenance.workflowId);
      executions.add(provenance.executionId);
    }

    const impact: ArtifactImpact = artifactImpactSchema.parse({
      artifactId,
      affectedArtifacts,
      affectedWorkflows: [...workflows],
      affectedExecutions: [...executions],
    });

    await this.publish(
      nodes.get(artifactId)?.provenance,
      "artifact.impact_analyzed",
      {
        artifactId,
        affectedCount: affectedArtifacts.length,
        ...(version !== undefined ? { version } : {}),
      },
    );

    return impact;
  }

  // ── Version diff ──────────────────────────────────────────────

  public async diffVersions(
    artifactId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<ArtifactDiff> {
    const from = await this.registry.getVersion(artifactId, fromVersion);
    if (from === null) {
      throw new ArtifactVersionNotFoundError(artifactId, fromVersion, {
        operation: "diffVersions",
        endpoint: "from",
      });
    }

    const to = await this.registry.getVersion(artifactId, toVersion);
    if (to === null) {
      throw new ArtifactVersionNotFoundError(artifactId, toVersion, {
        operation: "diffVersions",
        endpoint: "to",
      });
    }

    const metadataChanges = diffMetadata(from.metadata, to.metadata);

    // Hashes are content-derived, so equal hashes mean equal content. The
    // key-level breakdown is reported either way.
    const changed = from.hash !== to.hash;

    const diff: ArtifactDiff = artifactDiffSchema.parse({
      artifactId,
      fromVersion,
      toVersion,
      changed,
      metadataChanges,
    });

    const artifact = await this.registry.getArtifact(artifactId);

    await this.publish(artifact?.provenance, "artifact.diff_created", {
      artifactId,
      fromVersion,
      toVersion,
      changed,
    });

    return diff;
  }

  // ── Reuse detection ───────────────────────────────────────────

  public async findReusableArtifacts(
    artifactIds: readonly ArtifactVersionRef[],
  ): Promise<ArtifactReuseReport> {
    const candidates: ArtifactReuseCandidate[] = [];

    for (const requested of artifactIds) {
      const ref = artifactVersionRefSchema.parse(requested);
      const artifact = await this.registry.getArtifact(ref.artifactId);

      if (artifact === null) {
        candidates.push({
          artifactId: ref.artifactId,
          ...(ref.version !== undefined
            ? { requestedVersion: ref.version }
            : {}),
          reusable: false,
          reason: "missing",
        });
        continue;
      }

      // Same id at the same version is the same artifact — reusable. Any
      // advance in version means the work that produced it is stale.
      const unchanged =
        ref.version === undefined || ref.version === artifact.version;

      candidates.push({
        artifactId: ref.artifactId,
        currentVersion: artifact.version,
        ...(ref.version !== undefined ? { requestedVersion: ref.version } : {}),
        reusable: unchanged,
        reason: unchanged ? "unchanged" : "version_changed",
      });
    }

    return artifactReuseReportSchema.parse({
      candidates,
      reusable: candidates
        .filter((candidate) => candidate.reusable)
        .map((candidate) => candidate.artifactId),
      allReusable:
        candidates.length > 0 &&
        candidates.every((candidate) => candidate.reusable),
    });
  }

  // ── Internals ─────────────────────────────────────────────────

  private async publish(
    provenance: ArtifactProvenance | undefined,
    type: ExecutionEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.eventPublisher === undefined) return;
    if (provenance === undefined) return;

    const event = executionEventSchema.parse({
      id: crypto.randomUUID(),
      executionId: provenance.executionId,
      type,
      timestamp: Date.now(),
      payload,
    });

    await this.eventPublisher.publish(event);
  }
}

// ── Graph Traversal ─────────────────────────────────────────────

/**
 * Breadth-first walk over lineage relations only, nearest first.
 *
 * `dependencies` follows source -> target (toward what an artifact was built
 * from); `dependents` follows target -> source (toward what was built from
 * it). `replaced_by` is excluded: a supersession says nothing about what an
 * artifact was built from, so following it would report a replacement as a
 * dependency.
 */
function walk(
  graph: ArtifactLineageGraph,
  artifactId: string,
  direction: "dependencies" | "dependents",
): string[] {
  const edges = graph.relations.filter((edge) =>
    isLineageRelation(edge.relation),
  );

  const visited = new Set<string>([artifactId]);
  const order: string[] = [];
  let frontier: string[] = [artifactId];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const current of frontier) {
      for (const edge of edges) {
        const from =
          direction === "dependencies"
            ? edge.sourceArtifactId
            : edge.targetArtifactId;
        const to =
          direction === "dependencies"
            ? edge.targetArtifactId
            : edge.sourceArtifactId;

        if (from !== current || visited.has(to)) continue;

        visited.add(to);
        order.push(to);
        next.push(to);
      }
    }

    frontier = next;
  }

  return order;
}

// ── Metadata Diff ───────────────────────────────────────────────

/**
 * Key-level comparison of two metadata records.
 *
 * Values are compared canonically, so a reordered nested object is not
 * reported as modified.
 */
function diffMetadata(
  from: Record<string, unknown> | undefined,
  to: Record<string, unknown> | undefined,
): ArtifactMetadataChanges {
  const before = from ?? {};
  const after = to ?? {};

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const key of Object.keys(after)) {
    if (!Object.hasOwn(before, key)) {
      added.push(key);
      continue;
    }

    if (!contentEquals(before[key], after[key])) {
      modified.push(key);
    }
  }

  for (const key of Object.keys(before)) {
    if (!Object.hasOwn(after, key)) {
      removed.push(key);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    modified: modified.sort(),
  };
}
