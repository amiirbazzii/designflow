// packages/storage-file/src/adapters.ts
import {
  DesignFlowError,
  approvalRequestSchema,
  artifactInputSchema,
  artifactRefSchema,
  artifactRelationSchema,
  artifactSchema,
  artifactVersionSchema,
  executionCheckpointDataSchema,
  executionEventSchema,
  executionRecordSchema,
  lifecycleEventSchema,
} from "@designflow/sdk";
import {
  agentTraceSchema,
  agentTracePatchSchema,
  selectTraces,
} from "@designflow/sdk";
import type {
  AgentTrace,
  AgentTracePatch,
  TraceFilters,
  TraceStore,
  ApprovalManager,
  ApprovalRequest,
  Artifact,
  ArtifactInput,
  ArtifactLineage,
  ArtifactLineageGraph,
  ArtifactProvenance,
  ArtifactRef,
  ArtifactRelation,
  ArtifactRelationType,
  ArtifactVersion,
  ExecutionCheckpointData,
  ExecutionEvent,
  ExecutionEventHandler,
  ExecutionEventPublisher,
  ExecutionEventType,
  ExecutionRecord,
  ExecutionRepository,
  LifecycleEvent,
  RegistryArtifactStore,
} from "@designflow/sdk";
import { FileStore, clone, hashContent } from "./store";

/**
 * File-backed implementations of the four storage contracts.
 *
 * Node-only: `node:fs` and `node:crypto`, nothing else. That is the point —
 * a CLI installed with `npm install -g` must run wherever Node runs.
 */

// ── Execution repository ────────────────────────────────────────

export class FileExecutionRepository implements ExecutionRepository {
  private readonly store: FileStore;

  public constructor(store: FileStore) {
    this.store = store;
  }

  public async create(record: ExecutionRecord): Promise<void> {
    const validated = executionRecordSchema.parse(record);

    this.store.mutate((document) => {
      document.executions[validated.executionId] = validated;
    });
  }

  public async update(
    executionId: string,
    patch: Partial<Omit<ExecutionRecord, "executionId">>,
  ): Promise<void> {
    const existing = await this.get(executionId);
    if (existing === null) return;

    await this.create({ ...existing, ...patch, executionId });
  }

  public async get(executionId: string): Promise<ExecutionRecord | null> {
    const record = this.store.data.executions[executionId];
    return record === undefined ? null : clone(record);
  }

  public async list(workflowId: string): Promise<readonly ExecutionRecord[]> {
    return this.newestFirst().filter(
      (record) => record.workflowId === workflowId,
    );
  }

  public async listAll(limit = 100): Promise<readonly ExecutionRecord[]> {
    return this.newestFirst().slice(0, limit);
  }

  public async appendEvent(event: LifecycleEvent): Promise<void> {
    const validated = lifecycleEventSchema.parse(event);

    this.store.mutate((document) => {
      document.lifecycleEvents.push(validated);
    });
  }

  public async listEvents(
    executionId: string,
  ): Promise<readonly LifecycleEvent[]> {
    return this.store.data.lifecycleEvents
      .filter((event) => event.executionId === executionId)
      .map((event) => clone(event));
  }

  public async saveCheckpoint(
    executionId: string,
    checkpoint: ExecutionCheckpointData,
  ): Promise<void> {
    const validated = executionCheckpointDataSchema.parse(checkpoint);

    this.store.mutate((document) => {
      document.checkpoints.push({ ...validated, ownerExecutionId: executionId });
    });
  }

  public async getLatestCheckpoint(
    executionId: string,
  ): Promise<ExecutionCheckpointData | null> {
    const owned = this.store.data.checkpoints.filter(
      (checkpoint) => checkpoint.ownerExecutionId === executionId,
    );

    const latest = owned[owned.length - 1];
    if (latest === undefined) return null;

    return executionCheckpointDataSchema.parse({
      executionId: latest.executionId,
      phase: latest.phase,
      timestamp: latest.timestamp,
      state: latest.state,
      metadata: latest.metadata,
    });
  }

  private newestFirst(): ExecutionRecord[] {
    return Object.values(this.store.data.executions)
      .map((record) => clone(record))
      .sort((left, right) => right.startedAt - left.startedAt);
  }
}

// ── Approvals ───────────────────────────────────────────────────

export class ApprovalNotFoundError extends DesignFlowError {
  public constructor(approvalId: string) {
    super("ERR_APPROVAL_NOT_FOUND", `Approval not found: ${approvalId}`, {
      approvalId,
    });
    this.name = "ApprovalNotFoundError";
    Object.setPrototypeOf(this, ApprovalNotFoundError.prototype);
  }
}

export class ApprovalStateTransitionError extends DesignFlowError {
  public constructor(approvalId: string, from: string, to: string) {
    super(
      "ERR_APPROVAL_STATE_TRANSITION",
      `Approval ${approvalId} is already ${from} and cannot become ${to}`,
      { approvalId, from, to },
    );
    this.name = "ApprovalStateTransitionError";
    Object.setPrototypeOf(this, ApprovalStateTransitionError.prototype);
  }
}

export class FileApprovalManager implements ApprovalManager {
  private readonly store: FileStore;

  public constructor(store: FileStore) {
    this.store = store;
  }

  public async createRequest(
    executionId: string,
    workflowId: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const request = approvalRequestSchema.parse({
      id: crypto.randomUUID(),
      executionId,
      workflowId,
      status: "pending",
      reason,
      createdAt: Date.now(),
    });

    this.store.mutate((document) => {
      document.approvals[request.id] = request;
    });

    return request;
  }

  public async approve(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    return this.settle(approvalId, "approved", comment);
  }

  public async reject(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    return this.settle(approvalId, "rejected", comment);
  }

  public async get(approvalId: string): Promise<ApprovalRequest | null> {
    const request = this.store.data.approvals[approvalId];
    return request === undefined ? null : clone(request);
  }

  private async settle(
    approvalId: string,
    status: "approved" | "rejected",
    comment: string | undefined,
  ): Promise<ApprovalRequest> {
    const existing = await this.get(approvalId);
    if (existing === null) throw new ApprovalNotFoundError(approvalId);

    // Only pending may transition, so a double-answered approval cannot flip
    // a rejection into an approval.
    if (existing.status !== "pending") {
      throw new ApprovalStateTransitionError(
        approvalId,
        existing.status,
        status,
      );
    }

    const settled = approvalRequestSchema.parse({
      ...existing,
      status,
      resolvedAt: Date.now(),
      ...(comment !== undefined ? { metadata: { comment } } : {}),
    });

    this.store.mutate((document) => {
      document.approvals[approvalId] = settled;
    });

    return settled;
  }
}

// ── Event store ─────────────────────────────────────────────────

/**
 * The raw event stream.
 *
 * Structurally satisfies the product layer's `ExecutionEventSource` without
 * importing it. It exists because the engine's own subscriber keeps only
 * events that map to a lifecycle phase, dropping every `artifact.*` event —
 * the ones that explain what a run reused and changed.
 */
export class FileExecutionEventStore {
  private readonly store: FileStore;

  public constructor(store: FileStore) {
    this.store = store;
  }

  public createHandler(): ExecutionEventHandler {
    return (event: ExecutionEvent): void => {
      this.append(event);
    };
  }

  public subscribeTo(publisher: ExecutionEventPublisher): void {
    publisher.subscribe(this.createHandler());
  }

  public append(event: ExecutionEvent): void {
    const validated = executionEventSchema.parse(event);

    this.store.mutate((document) => {
      document.events.push(validated);
    });
  }

  public async listEvents(
    executionId: string,
  ): Promise<readonly ExecutionEvent[]> {
    return this.store.data.events
      .filter((event) => event.executionId === executionId)
      .map((event) => clone(event));
  }
}

// ── Artifact store ──────────────────────────────────────────────

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

export interface FileArtifactStoreOptions {
  /**
   * Receives `artifact.*` events, matching every other backend.
   *
   * The product layer builds its artifact summaries from `artifact.created`,
   * so a silent store produces runs whose artifacts are invisible however many
   * are on disk.
   */
  readonly eventPublisher?: ExecutionEventPublisher | undefined;
}

export class FileArtifactStore implements RegistryArtifactStore {
  private readonly store: FileStore;
  private readonly eventPublisher: ExecutionEventPublisher | undefined;

  public constructor(store: FileStore, options?: FileArtifactStoreOptions) {
    this.store = store;
    this.eventPublisher = options?.eventPublisher;
  }

  public async save(
    data: unknown,
    metadata?: Record<string, unknown>,
    lineage?: ArtifactLineage,
  ): Promise<ArtifactRef> {
    const id = hashContent(data);
    const resolvedMetadata = metadata ?? {};

    const ref: ArtifactRef = artifactRefSchema.parse({
      id,
      type: "artifact",
      metadata: resolvedMetadata,
      ...(lineage !== undefined ? { lineage } : {}),
    });

    this.store.mutate((document) => {
      document.payloads[id] = { ref, data: clone(data) };
    });

    // Content-addressed: identical bytes are the same artifact, so a repeat
    // save resolves rather than versioning.
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
    const stored = this.store.data.payloads[id];
    if (stored === undefined) return null;

    return { artifact: clone(stored.ref), data: clone(stored.data) };
  }

  public async exists(id: string): Promise<boolean> {
    return this.store.data.payloads[id] !== undefined;
  }

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

    const version = this.buildVersion(id, 1, createdAt, input.metadata);

    this.store.mutate((document) => {
      document.artifacts[id] = record;
      document.versions.push(version);
    });

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
    const version = this.buildVersion(artifactId, next, Date.now(), metadata);

    this.store.mutate((document) => {
      document.versions.push(version);

      const advanced = document.artifacts[artifactId];
      // Only the latest-version pointer moves; version records are immutable.
      if (advanced !== undefined) {
        document.artifacts[artifactId] = { ...advanced, version: next };
      }
    });

    await this.publish(current.provenance, "artifact.version_created", {
      artifactId,
      version: next,
    });

    return version;
  }

  public async getArtifact(id: string): Promise<Artifact | null> {
    const artifact = this.store.data.artifacts[id];
    return artifact === undefined ? null : clone(artifact);
  }

  public async getVersion(
    artifactId: string,
    version: number,
  ): Promise<ArtifactVersion | null> {
    const found = this.store.data.versions.find(
      (entry) => entry.artifactId === artifactId && entry.version === version,
    );

    return found === undefined ? null : clone(found);
  }

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

    const relations = this.store.data.relations;

    const duplicate = relations.some(
      (existing) =>
        existing.sourceArtifactId === edge.sourceArtifactId &&
        existing.targetArtifactId === edge.targetArtifactId &&
        existing.relation === edge.relation,
    );
    if (duplicate) return;

    // Cycles are checked over the whole lineage sub-graph: `A derived_from B,
    // B generated_from C, C derived_from A` is cyclic even though no single
    // relation type closes the loop.
    const closing = findPath(
      relations,
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

    this.store.mutate((document) => {
      document.relations.push(edge);
    });

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

    const relations = this.store.data.relations;

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
      relations: relations
        .filter(
          (edge) =>
            nodeIds.has(edge.sourceArtifactId) &&
            nodeIds.has(edge.targetArtifactId),
        )
        .map((edge) => clone(edge)),
      ancestors,
      descendants,
    };
  }

  private buildVersion(
    artifactId: string,
    version: number,
    createdAt: number,
    metadata: Record<string, unknown> | undefined,
  ): ArtifactVersion {
    // Content-only hash: the version number is excluded so equal content
    // hashes equally, which is what tells "changed" from "re-emitted".
    return artifactVersionSchema.parse({
      artifactId,
      version,
      hash: hashContent({ artifactId, metadata }),
      createdAt,
      ...(metadata !== undefined ? { metadata: clone(metadata) } : {}),
    });
  }

  private async publish(
    provenance: ArtifactProvenance | undefined,
    type: ExecutionEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.eventPublisher === undefined) return;
    // An artifact registered outside any execution has nothing to attribute
    // the event to, and `ExecutionEvent.executionId` is required.
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
}

// ── Graph helpers ───────────────────────────────────────────────

function findPath(
  relations: readonly ArtifactRelation[],
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

// ── Agent traces ────────────────────────────────────────────────

/**
 * Traces on disk, in the same document as everything else.
 *
 * Sharing `FileStore` buys the atomic write for free: a trace and the execution
 * it correlates to land in one rename, so an interrupted process cannot leave a
 * trace pointing at a run that was never recorded.
 *
 * Nothing about the engine's records changed to accommodate this. `traces` is a
 * new top-level collection, and `FileStore` fills in missing collections when
 * it reads, so a document written before this stage loads unchanged and simply
 * has no traces in it.
 *
 * Traces are validated on the way in *and* on the way out. On the way in
 * because a store is an audit record; on the way out because the file is
 * user-editable — someone can open `runs.json` in an editor, and a malformed
 * trace should be dropped rather than handed to a renderer as if it were real.
 */
export class FileTraceStore implements TraceStore {
  private readonly store: FileStore;

  public constructor(store: FileStore) {
    this.store = store;
  }

  public async create(trace: AgentTrace): Promise<void> {
    const validated = agentTraceSchema.parse(trace);

    this.store.mutate((document) => {
      document.traces[validated.id] = validated;
    });
  }

  public async update(traceId: string, patch: AgentTracePatch): Promise<void> {
    const validated = agentTracePatchSchema.parse(patch);

    this.store.mutate((document) => {
      const existing = document.traces[traceId];

      // Silent when the trace is unknown. An update whose create was lost
      // cannot be recovered by failing the update — that would turn a gap in
      // the record into a broken decision.
      if (existing === undefined) return;

      document.traces[traceId] = agentTraceSchema.parse({
        ...existing,
        ...validated,
      });
    });
  }

  public async get(traceId: string): Promise<AgentTrace | null> {
    const found = this.store.data.traces[traceId];
    if (found === undefined) return null;

    const parsed = agentTraceSchema.safeParse(found);
    return parsed.success ? parsed.data : null;
  }

  public async list(filters?: TraceFilters): Promise<readonly AgentTrace[]> {
    const stored = Object.values(this.store.data.traces);

    // Hand-edited or truncated entries are dropped rather than surfaced.
    const valid = stored.flatMap((trace) => {
      const parsed = agentTraceSchema.safeParse(trace);
      return parsed.success ? [parsed.data] : [];
    });

    return selectTraces(valid, filters);
  }
}
