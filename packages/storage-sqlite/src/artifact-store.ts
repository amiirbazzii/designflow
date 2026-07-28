// packages/storage-sqlite/src/artifact-store.ts
import type { Database } from "bun:sqlite";
import {
  DesignFlowError,
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
  ArtifactRef,
  ArtifactRelation,
  ArtifactRelationType,
  ArtifactProvenance,
  ArtifactVersion,
  ExecutionEventPublisher,
  ExecutionEventType,
  RegistryArtifactStore,
} from "@designflow/sdk";
import { asRow } from "./execution-repository";
import { fromJson, fromJsonRecord, toJson } from "./schema";

/**
 * `RegistryArtifactStore` backed by SQLite.
 *
 * A second backend for a contract that already existed, per §8.3 of the
 * constitution — not a redesign. Identity, versions, provenance and relations
 * live in tables; payload bytes live in their own table so a future object
 * store can replace that one piece.
 *
 * The graph rules (relation validation, cycle scope, lineage traversal) are
 * reimplemented here rather than shared with the in-memory store, because
 * `@designflow/core` is off-limits to a package under the import matrix.
 * Extracting them into the SDK would be the right long-term fix; a test suite
 * shared by both backends is the guard in the meantime.
 */

/** Relations that answer "where did this come from". */
const LINEAGE_RELATIONS: ReadonlySet<ArtifactRelationType> = new Set([
  "derived_from",
  "generated_from",
  "validated_by",
]);

function cycleScope(
  relation: ArtifactRelationType,
): ReadonlySet<ArtifactRelationType> {
  return LINEAGE_RELATIONS.has(relation)
    ? LINEAGE_RELATIONS
    : new Set<ArtifactRelationType>([relation]);
}

export class ArtifactConflictError extends DesignFlowError {
  public constructor(artifactId: string) {
    super("ERR_ARTIFACT_EXISTS", `Artifact already registered: ${artifactId}`, {
      artifactId,
    });
    this.name = "ArtifactConflictError";
    Object.setPrototypeOf(this, ArtifactConflictError.prototype);
  }
}

export class ArtifactNotFoundError extends DesignFlowError {
  public constructor(artifactId: string, operation: string) {
    super("ERR_ARTIFACT_NOT_FOUND", `Artifact not found: ${artifactId}`, {
      artifactId,
      operation,
    });
    this.name = "ArtifactNotFoundError";
    Object.setPrototypeOf(this, ArtifactNotFoundError.prototype);
  }
}

export class ArtifactCycleError extends DesignFlowError {
  public constructor(cyclePath: readonly string[], relation: string) {
    super(
      "ERR_ARTIFACT_CYCLE",
      `Artifact relation cycle detected: ${[...cyclePath].join(" -> ")}`,
      { cyclePath: [...cyclePath], relation },
    );
    this.name = "ArtifactCycleError";
    Object.setPrototypeOf(this, ArtifactCycleError.prototype);
  }
}

export interface SqliteArtifactStoreOptions {
  /**
   * Receives `artifact.*` events, matching the in-memory backend.
   *
   * Not optional in practice: the product layer builds its artifact summaries
   * from `artifact.created`, so a store that stays silent produces a run whose
   * artifacts are invisible even though the rows are on disk. Backends must be
   * interchangeable in what they announce, not just in what they store.
   */
  readonly eventPublisher?: ExecutionEventPublisher | undefined;
}

export class SqliteArtifactStore implements RegistryArtifactStore {
  private readonly db: Database;
  private readonly eventPublisher: ExecutionEventPublisher | undefined;

  public constructor(db: Database, options?: SqliteArtifactStoreOptions) {
    this.db = db;
    this.eventPublisher = options?.eventPublisher;
  }

  // ── Payloads ──────────────────────────────────────────────────

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

    this.db
      .query(
        `INSERT OR REPLACE INTO artifact_payloads (payload_id, ref_json, data_json)
         VALUES (?, ?, ?)`,
      )
      .run(id, JSON.stringify(ref), JSON.stringify(data ?? null));

    // Content-addressed: identical bytes are the same artifact, so a repeat
    // save resolves to the existing registration rather than versioning it.
    if ((await this.getArtifact(id)) === null) {
      await this.createArtifact({
        id,
        type: ref.type,
        metadata: resolvedMetadata,
        ...(lineage !== undefined
          ? {
              provenance: {
                executionId: lineage.executionId,
                workflowId: lineage.workflowId,
                capabilityId: lineage.capabilityId,
              },
            }
          : {}),
      });
    }

    for (const parentId of lineage?.parents ?? []) {
      if (parentId === id) continue;
      if ((await this.getArtifact(parentId)) === null) continue;

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
    const row = this.db
      .query("SELECT * FROM artifact_payloads WHERE payload_id = ?")
      .get(id);

    if (row === null) return null;

    const record = asRow(row);

    return {
      artifact: artifactRefSchema.parse(fromJsonRecord(record.ref_json)),
      data: fromJson(record.data_json),
    };
  }

  public async exists(id: string): Promise<boolean> {
    const row = this.db
      .query("SELECT 1 AS present FROM artifact_payloads WHERE payload_id = ?")
      .get(id);

    return row !== null;
  }

  // ── Identity and versions ─────────────────────────────────────

  public async createArtifact(artifact: ArtifactInput): Promise<Artifact> {
    const input = artifactInputSchema.parse(artifact);
    const id = input.id ?? crypto.randomUUID();

    if ((await this.getArtifact(id)) !== null) {
      throw new ArtifactConflictError(id);
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

    this.db
      .query(
        `INSERT INTO artifacts
           (artifact_id, type, version, created_at, metadata_json, provenance_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.type,
        record.version,
        record.createdAt,
        JSON.stringify(record.metadata),
        toJson(record.provenance),
      );

    await this.insertVersion(id, 1, createdAt, input.metadata);

    await this.publish(record.provenance, "artifact.created", {
      artifactId: id,
      version: 1,
    });
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
    const current = await this.getArtifact(artifactId);

    if (current === null) {
      throw new ArtifactNotFoundError(artifactId, "createVersion");
    }

    const next = current.version + 1;
    const createdAt = Date.now();

    const version = await this.insertVersion(
      artifactId,
      next,
      createdAt,
      metadata,
    );

    // Only the latest-version pointer moves; version rows are never rewritten.
    this.db
      .query("UPDATE artifacts SET version = ? WHERE artifact_id = ?")
      .run(next, artifactId);

    await this.publish(current.provenance, "artifact.version_created", {
      artifactId,
      version: next,
    });

    return version;
  }

  public async getArtifact(id: string): Promise<Artifact | null> {
    const row = this.db
      .query("SELECT * FROM artifacts WHERE artifact_id = ?")
      .get(id);

    if (row === null) return null;

    const record = asRow(row);
    const provenance = fromJson(record.provenance_json);

    return artifactSchema.parse({
      id: record.artifact_id,
      type: record.type,
      version: record.version,
      createdAt: record.created_at,
      metadata: fromJsonRecord(record.metadata_json),
      ...(provenance !== undefined ? { provenance } : {}),
    });
  }

  public async getVersion(
    artifactId: string,
    version: number,
  ): Promise<ArtifactVersion | null> {
    const row = this.db
      .query(
        "SELECT * FROM artifact_versions WHERE artifact_id = ? AND version = ?",
      )
      .get(artifactId, version);

    if (row === null) return null;

    const record = asRow(row);
    const metadata = fromJson(record.metadata_json);

    return artifactVersionSchema.parse({
      artifactId: record.artifact_id,
      version: record.version,
      hash: record.hash,
      createdAt: record.created_at,
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  // ── Relations and lineage ─────────────────────────────────────

  public async addRelation(relation: ArtifactRelation): Promise<void> {
    const edge = artifactRelationSchema.parse(relation);

    if (edge.sourceArtifactId === edge.targetArtifactId) {
      throw new ArtifactCycleError(
        [edge.sourceArtifactId, edge.targetArtifactId],
        edge.relation,
      );
    }

    if ((await this.getArtifact(edge.sourceArtifactId)) === null) {
      throw new ArtifactNotFoundError(edge.sourceArtifactId, "addRelation");
    }

    if ((await this.getArtifact(edge.targetArtifactId)) === null) {
      throw new ArtifactNotFoundError(edge.targetArtifactId, "addRelation");
    }

    const duplicate = this.db
      .query(
        `SELECT 1 AS present FROM artifact_relations
         WHERE source_id = ? AND target_id = ? AND relation = ?`,
      )
      .get(edge.sourceArtifactId, edge.targetArtifactId, edge.relation);

    if (duplicate !== null) return;

    // Cycles are checked over the whole lineage sub-graph rather than one
    // relation type: `A derived_from B, B generated_from C, C derived_from A`
    // is cyclic even though no single type closes the loop.
    const closing = this.findPath(
      edge.targetArtifactId,
      edge.sourceArtifactId,
      cycleScope(edge.relation),
    );

    if (closing !== null) {
      throw new ArtifactCycleError(
        [edge.sourceArtifactId, ...closing],
        edge.relation,
      );
    }

    this.db
      .query(
        `INSERT INTO artifact_relations (source_id, target_id, relation)
         VALUES (?, ?, ?)`,
      )
      .run(edge.sourceArtifactId, edge.targetArtifactId, edge.relation);

    const source = await this.getArtifact(edge.sourceArtifactId);
    const target = await this.getArtifact(edge.targetArtifactId);

    await this.publish(
      source?.provenance ?? target?.provenance,
      "artifact.relation_added",
      {
        artifactId: edge.sourceArtifactId,
        targetArtifactId: edge.targetArtifactId,
        relation: edge.relation,
      },
    );
  }

  public async getLineage(artifactId: string): Promise<ArtifactLineageGraph> {
    if ((await this.getArtifact(artifactId)) === null) {
      throw new ArtifactNotFoundError(artifactId, "getLineage");
    }

    const relations = this.allRelations();

    const ancestors = traverse(relations, artifactId, "forward");
    const descendants = traverse(relations, artifactId, "backward");

    const nodeIds = new Set<string>([artifactId, ...ancestors, ...descendants]);

    const nodes: Artifact[] = [];
    for (const id of nodeIds) {
      const artifact = await this.getArtifact(id);
      if (artifact !== null) nodes.push(artifact);
    }

    return {
      artifactId,
      nodes,
      relations: relations.filter(
        (edge) =>
          nodeIds.has(edge.sourceArtifactId) &&
          nodeIds.has(edge.targetArtifactId),
      ),
      ancestors,
      descendants,
    };
  }

  // ── Internals ─────────────────────────────────────────────────

  private async insertVersion(
    artifactId: string,
    version: number,
    createdAt: number,
    metadata: Record<string, unknown> | undefined,
  ): Promise<ArtifactVersion> {
    // Content-only hash: the version number is excluded so equal content
    // hashes equally, which is what tells "changed" from "re-emitted".
    const hash = await hashContent({ artifactId, metadata });

    const record: ArtifactVersion = artifactVersionSchema.parse({
      artifactId,
      version,
      hash,
      createdAt,
      ...(metadata !== undefined ? { metadata } : {}),
    });

    this.db
      .query(
        `INSERT OR REPLACE INTO artifact_versions
           (artifact_id, version, hash, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(artifactId, version, hash, createdAt, toJson(metadata));

    return record;
  }

  /**
   * Events are attributed to the execution named by the artifact's provenance.
   * An artifact registered outside any execution has none, and publishes
   * nothing — `ExecutionEvent.executionId` is required, and inventing one
   * would corrupt every per-execution query.
   */
  private async publish(
    provenance: ArtifactProvenance | undefined,
    type: ExecutionEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.eventPublisher === undefined) return;
    if (provenance === undefined) return;

    await this.eventPublisher.publish(
      executionEventSchema.parse({
        id: crypto.randomUUID(),
        executionId: provenance.executionId,
        type,
        timestamp: Date.now(),
        payload,
      }),
    );
  }

  private allRelations(): ArtifactRelation[] {
    return this.db
      .query("SELECT * FROM artifact_relations")
      .all()
      .map((row) => {
        const record = asRow(row);
        return artifactRelationSchema.parse({
          sourceArtifactId: record.source_id,
          targetArtifactId: record.target_id,
          relation: record.relation,
        });
      });
  }

  private findPath(
    from: string,
    to: string,
    scope: ReadonlySet<ArtifactRelationType>,
  ): readonly string[] | null {
    const relations = this.allRelations();
    const queue: Array<readonly string[]> = [[from]];
    const seen = new Set<string>([from]);

    while (queue.length > 0) {
      const path = queue.shift();
      if (path === undefined) break;

      const head = path[path.length - 1];
      if (head === undefined) continue;
      if (head === to) return path;

      for (const edge of relations) {
        if (!scope.has(edge.relation)) continue;
        if (edge.sourceArtifactId !== head) continue;
        if (seen.has(edge.targetArtifactId)) continue;

        seen.add(edge.targetArtifactId);
        queue.push([...path, edge.targetArtifactId]);
      }
    }

    return null;
  }
}

/** Ids reachable from `artifactId`, nearest first, over lineage edges only. */
function traverse(
  relations: readonly ArtifactRelation[],
  artifactId: string,
  direction: "forward" | "backward",
): string[] {
  const visited = new Set<string>([artifactId]);
  const order: string[] = [];
  let frontier: string[] = [artifactId];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const current of frontier) {
      for (const edge of relations) {
        const from =
          direction === "forward"
            ? edge.sourceArtifactId
            : edge.targetArtifactId;
        const to =
          direction === "forward"
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

/** Canonical, order-independent content hash. */
async function hashContent(value: unknown): Promise<string> {
  const serialized = JSON.stringify(canonicalize(value));

  if (serialized === undefined) {
    throw new DesignFlowError(
      "ERR_ARTIFACT_INVALID_DATA",
      "Value cannot be serialized for hashing",
      { valueType: typeof value },
    );
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map(canonicalize);
  }

  if (isRecord(value)) {
    const ordered: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      ordered[key] = canonicalize(value[key]);
    }

    return ordered;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
