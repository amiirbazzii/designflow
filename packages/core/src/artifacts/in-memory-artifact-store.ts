// packages/core/src/artifacts/in-memory-artifact-store.ts
import {
  artifactInputSchema,
  artifactRefSchema,
  artifactRelationSchema,
  artifactSchema,
  artifactVersionSchema,
  executionEventSchema,
} from "@designflow/sdk";
import type {
  Artifact,
  ArtifactInput,
  ArtifactLineage,
  ArtifactLineageGraph,
  ArtifactProvenance,
  ArtifactRef,
  ArtifactRelation,
  ArtifactRelationType,
  ArtifactVersion,
  ExecutionEventPublisher,
  ExecutionEventType,
  RegistryArtifactStore,
} from "@designflow/sdk";
import {
  ArtifactConflictError,
  ArtifactCycleError,
  ArtifactNotFoundError,
} from "../errors";
import { clone, deepFreeze } from "./immutability";
import { hashContent } from "./hashing";
import { cycleScope } from "./relations";

// ── Internal State ──────────────────────────────────────────────

/** Payload plus the reference handed back for it, kept out of the registry. */
interface StoredPayload {
  readonly ref: ArtifactRef;
  readonly data: unknown;
}

export interface InMemoryArtifactStoreOptions {
  /**
   * Receives `artifact.*` events. Events are attributed to the execution named
   * by the artifact's provenance; artifacts registered outside any execution
   * carry no provenance and therefore publish nothing.
   */
  readonly eventPublisher?: ExecutionEventPublisher;
}

// ── In-Memory Artifact Store ────────────────────────────────────

/**
 * Reference implementation of the artifact registry, backed by process memory.
 *
 * Layering follows `ArtifactStore -> Artifact Registry`: `save`/`get`/`exists`
 * own payloads, everything else owns identity, versions, provenance and
 * relations. Payloads are never copied into the registry, so a payload-heavy
 * backend can be swapped in without touching lineage.
 */
export class InMemoryArtifactStore implements RegistryArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly versions = new Map<string, ArtifactVersion[]>();
  private readonly relations: ArtifactRelation[] = [];
  private readonly payloads = new Map<string, StoredPayload>();
  private readonly eventPublisher: ExecutionEventPublisher | undefined;

  public constructor(options?: InMemoryArtifactStoreOptions) {
    this.eventPublisher = options?.eventPublisher;
  }

  // ── ArtifactStore: payloads ───────────────────────────────────

  public async save(
    data: unknown,
    metadata?: Record<string, unknown>,
    lineage?: ArtifactLineage,
  ): Promise<ArtifactRef> {
    const id = await hashContent(data);
    const resolvedMetadata = metadata ?? {};

    const ref: ArtifactRef = artifactRefSchema.parse({
      id,
      type: "artifact",
      metadata: resolvedMetadata,
      ...(lineage !== undefined ? { lineage } : {}),
    });

    this.payloads.set(id, deepFreeze({ ref, data: clone(data) }));

    // Content-addressed: identical bytes are the same artifact, so a repeat
    // save resolves to the existing registration rather than versioning it.
    if (!this.artifacts.has(id)) {
      await this.createArtifact({
        id,
        type: ref.type,
        metadata: resolvedMetadata,
        ...(lineage !== undefined
          ? { provenance: provenanceFromLineage(lineage) }
          : {}),
      });
    }

    for (const parentId of lineage?.parents ?? []) {
      if (parentId === id || !this.artifacts.has(parentId)) continue;
      await this.addRelation({
        sourceArtifactId: id,
        targetArtifactId: parentId,
        relation: "derived_from",
      });
    }

    return ref;
  }

  public async get(
    id: string,
  ): Promise<{ artifact: ArtifactRef; data: unknown } | null> {
    const stored = this.payloads.get(id);
    if (stored === undefined) return null;

    return { artifact: stored.ref, data: clone(stored.data) };
  }

  public async exists(id: string): Promise<boolean> {
    return this.payloads.has(id);
  }

  // ── ArtifactRegistry: identity & versions ─────────────────────

  public async createArtifact(artifact: ArtifactInput): Promise<Artifact> {
    const input = artifactInputSchema.parse(artifact);
    const id = input.id ?? crypto.randomUUID();

    if (this.artifacts.has(id)) {
      throw new ArtifactConflictError(id, { type: input.type });
    }

    const createdAt = Date.now();

    const record: Artifact = artifactSchema.parse({
      id,
      type: input.type,
      version: 1,
      createdAt,
      metadata: input.metadata,
      ...(input.provenance !== undefined
        ? { provenance: input.provenance }
        : {}),
    });

    this.artifacts.set(id, deepFreeze(record));

    const firstVersion = await this.buildVersion(id, 1, createdAt, input.metadata);
    this.versions.set(id, [firstVersion]);

    await this.publish(record.provenance, "artifact.created", {
      artifactId: id,
      version: 1,
    });

    // Version 1 is announced too, so a subscriber materializing a version
    // index never has to special-case the artifact's first version.
    await this.publish(record.provenance, "artifact.version_created", {
      artifactId: id,
      version: 1,
    });

    return record;
  }

  public async createVersion(
    artifactId: string,
    metadata?: Record<string, unknown>,
  ): Promise<ArtifactVersion> {
    const current = this.artifacts.get(artifactId);

    if (current === undefined) {
      throw new ArtifactNotFoundError(artifactId, {
        operation: "createVersion",
      });
    }

    const nextNumber = current.version + 1;
    const createdAt = Date.now();

    const version = await this.buildVersion(
      artifactId,
      nextNumber,
      createdAt,
      metadata,
    );

    const history = this.versions.get(artifactId);
    if (history === undefined) {
      throw new ArtifactNotFoundError(artifactId, {
        operation: "createVersion",
        reason: "version history missing",
      });
    }
    history.push(version);

    // Only the artifact header's latest-version pointer advances. Existing
    // version records are never rewritten.
    const advanced: Artifact = artifactSchema.parse({
      ...current,
      version: nextNumber,
    });
    this.artifacts.set(artifactId, deepFreeze(advanced));

    await this.publish(advanced.provenance, "artifact.version_created", {
      artifactId,
      version: nextNumber,
    });

    return version;
  }

  public async getArtifact(id: string): Promise<Artifact | null> {
    return this.artifacts.get(id) ?? null;
  }

  public async getVersion(
    artifactId: string,
    version: number,
  ): Promise<ArtifactVersion | null> {
    const history = this.versions.get(artifactId);
    if (history === undefined) return null;

    return history.find((entry) => entry.version === version) ?? null;
  }

  // ── ArtifactRegistry: relations & lineage ─────────────────────

  public async addRelation(relation: ArtifactRelation): Promise<void> {
    const edge = artifactRelationSchema.parse(relation);

    if (edge.sourceArtifactId === edge.targetArtifactId) {
      throw new ArtifactCycleError(
        [edge.sourceArtifactId, edge.targetArtifactId],
        { relation: edge.relation },
      );
    }

    const source = this.artifacts.get(edge.sourceArtifactId);
    if (source === undefined) {
      throw new ArtifactNotFoundError(edge.sourceArtifactId, {
        operation: "addRelation",
        endpoint: "source",
        relation: edge.relation,
      });
    }

    const target = this.artifacts.get(edge.targetArtifactId);
    if (target === undefined) {
      throw new ArtifactNotFoundError(edge.targetArtifactId, {
        operation: "addRelation",
        endpoint: "target",
        relation: edge.relation,
      });
    }

    const duplicate = this.relations.some(
      (existing) =>
        existing.sourceArtifactId === edge.sourceArtifactId &&
        existing.targetArtifactId === edge.targetArtifactId &&
        existing.relation === edge.relation,
    );

    if (duplicate) return;

    // Cycles are checked over the whole lineage sub-graph, not one relation
    // type: `A derived_from B`, `B generated_from C`, `C derived_from A` is a
    // cyclic lineage even though no single relation type closes the loop.
    const closingPath = this.findPath(
      edge.targetArtifactId,
      edge.sourceArtifactId,
      cycleScope(edge.relation),
    );

    if (closingPath !== null) {
      throw new ArtifactCycleError([edge.sourceArtifactId, ...closingPath], {
        relation: edge.relation,
      });
    }

    this.relations.push(deepFreeze(edge));

    await this.publish(source.provenance ?? target.provenance, "artifact.relation_added", {
      artifactId: edge.sourceArtifactId,
      targetArtifactId: edge.targetArtifactId,
      relation: edge.relation,
    });
  }

  public async getLineage(artifactId: string): Promise<ArtifactLineageGraph> {
    const subject = this.artifacts.get(artifactId);

    if (subject === undefined) {
      throw new ArtifactNotFoundError(artifactId, { operation: "getLineage" });
    }

    const ancestors = this.traverse(artifactId, "forward");
    const descendants = this.traverse(artifactId, "backward");

    const nodeIds = new Set<string>([artifactId, ...ancestors, ...descendants]);

    const nodes: Artifact[] = [];
    for (const id of nodeIds) {
      const node = this.artifacts.get(id);
      if (node !== undefined) nodes.push(node);
    }

    const relations = this.relations.filter(
      (edge) =>
        nodeIds.has(edge.sourceArtifactId) && nodeIds.has(edge.targetArtifactId),
    );

    return deepFreeze({
      artifactId,
      nodes,
      relations,
      ancestors,
      descendants,
    });
  }

  // ── Internals ─────────────────────────────────────────────────

  private async buildVersion(
    artifactId: string,
    version: number,
    createdAt: number,
    metadata: Record<string, unknown> | undefined,
  ): Promise<ArtifactVersion> {
    // Content-only: the version *number* is deliberately excluded so that two
    // revisions carrying the same content hash identically, which is what lets
    // a caller tell "changed" from "re-emitted unchanged".
    const hash = await hashContent({ artifactId, metadata });

    const record: ArtifactVersion = artifactVersionSchema.parse({
      artifactId,
      version,
      hash,
      createdAt,
      ...(metadata !== undefined ? { metadata: clone(metadata) } : {}),
    });

    return deepFreeze(record);
  }

  /**
   * Breadth-first walk over relations whose type is in `scope`, returning the
   * chain from `from` to `to`, or null when `to` is unreachable.
   */
  private findPath(
    from: string,
    to: string,
    scope: ReadonlySet<ArtifactRelationType>,
  ): readonly string[] | null {
    const queue: Array<readonly string[]> = [[from]];
    const seen = new Set<string>([from]);

    while (queue.length > 0) {
      const path = queue.shift();
      if (path === undefined) break;

      const head = path[path.length - 1];
      if (head === undefined) continue;

      if (head === to) return path;

      for (const edge of this.relations) {
        if (!scope.has(edge.relation)) continue;
        if (edge.sourceArtifactId !== head) continue;
        if (seen.has(edge.targetArtifactId)) continue;

        seen.add(edge.targetArtifactId);
        queue.push([...path, edge.targetArtifactId]);
      }
    }

    return null;
  }

  /**
   * Ids reachable from `artifactId` across every relation type, nearest first.
   * "forward" follows source -> target (toward origins); "backward" follows
   * target -> source (toward things built from this artifact).
   */
  private traverse(
    artifactId: string,
    direction: "forward" | "backward",
  ): string[] {
    const visited = new Set<string>([artifactId]);
    const order: string[] = [];
    let frontier: string[] = [artifactId];

    while (frontier.length > 0) {
      const next: string[] = [];

      for (const current of frontier) {
        for (const edge of this.relations) {
          const from = direction === "forward"
            ? edge.sourceArtifactId
            : edge.targetArtifactId;
          const to = direction === "forward"
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

function provenanceFromLineage(lineage: ArtifactLineage): ArtifactProvenance {
  return {
    executionId: lineage.executionId,
    workflowId: lineage.workflowId,
    capabilityId: lineage.capabilityId,
  };
}
