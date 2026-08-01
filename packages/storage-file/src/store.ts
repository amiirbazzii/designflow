// packages/storage-file/src/store.ts
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentMemory,
  AgentSession,
  AgentTrace,
  Artifact,
  ArtifactRef,
  ArtifactRelation,
  ArtifactVersion,
  ApprovalRequest,
  ExecutionCheckpointData,
  ExecutionEvent,
  ExecutionRecord,
  LifecycleEvent,
  MemoryProposal,
  ProjectContext,
  ProjectIdentity,
} from "@designflow/sdk";

/**
 * A JSON document on disk, holding everything a local install has recorded.
 *
 * Chosen over SQLite so the CLI can be a plain `npm install -g` with **no
 * native module and no non-Node runtime**. `bun:sqlite` ties a package to Bun;
 * `better-sqlite3` needs a compiler on any platform without a prebuild. For a
 * single-user CLI whose history is a few hundred rows, neither cost buys
 * anything.
 *
 * The whole document is rewritten on every mutation. That is O(document) per
 * write and would be wrong for a server — `@designflow/storage-sqlite` exists
 * for that tier. Here it keeps the implementation small enough to be obviously
 * correct.
 */

export interface StoredCheckpoint extends ExecutionCheckpointData {
  readonly ownerExecutionId: string;
}

export interface StoredPayload {
  readonly ref: ArtifactRef;
  readonly data: unknown;
}

export interface StoreDocument {
  version: number;
  executions: Record<string, ExecutionRecord>;
  lifecycleEvents: LifecycleEvent[];
  checkpoints: StoredCheckpoint[];
  approvals: Record<string, ApprovalRequest>;
  events: ExecutionEvent[];
  artifacts: Record<string, Artifact>;
  versions: ArtifactVersion[];
  relations: ArtifactRelation[];
  payloads: Record<string, StoredPayload>;
  /**
   * Agent decision traces.
   *
   * A sibling collection rather than a change to any engine record: nothing in
   * `executions`, `events` or `artifacts` gained a field, so the engine's view
   * of this document is byte-identical to what it was. Traces live here to
   * inherit the atomic write — a run and the trace that started it are written
   * in one rename, so they cannot disagree after a crash.
   */
  traces: Record<string, AgentTrace>;
  /**
   * Agent sessions — bounded clarification state, product-level rather than
   * engine-level.
   *
   * A sibling collection, the same reasoning as `traces`: nothing in
   * `executions`, `events` or `artifacts` gained a field, and a session lives
   * here to inherit the atomic write — a session and the execution it starts
   * are written under one rename, so they cannot disagree after a crash.
   */
  sessions: Record<string, AgentSession>;
  /**
   * Project identities — the scope key Project Context and Agent Memory key
   * off of. A sibling collection, same reasoning as `traces`/`sessions`.
   */
  projects: Record<string, ProjectIdentity>;
  /** One context document per project, keyed by `projectId`. */
  projectContexts: Record<string, ProjectContext>;
  /** Durable, explicitly approved agent memory. */
  agentMemories: Record<string, AgentMemory>;
  /** Memory an agent proposed, awaiting a person's approval or rejection. */
  memoryProposals: Record<string, MemoryProposal>;
}

function emptyDocument(): StoreDocument {
  return {
    version: 1,
    executions: {},
    lifecycleEvents: [],
    checkpoints: [],
    approvals: {},
    events: [],
    artifacts: {},
    versions: [],
    relations: [],
    payloads: {},
    traces: {},
    sessions: {},
    projects: {},
    projectContexts: {},
    agentMemories: {},
    memoryProposals: {},
  };
}

export class FileStore {
  private readonly path: string;
  private document: StoreDocument;

  public constructor(path: string) {
    this.path = path;
    this.document = this.read();
  }

  public get data(): StoreDocument {
    return this.document;
  }

  /** Applies a change and persists it. */
  public mutate<T>(change: (document: StoreDocument) => T): T {
    const result = change(this.document);
    this.write();
    return result;
  }

  /** Re-reads from disk, discarding anything held in memory. */
  public reload(): void {
    this.document = this.read();
  }

  public close(): void {
    this.write();
  }

  private read(): StoreDocument {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));

      if (typeof parsed !== "object" || parsed === null) {
        return emptyDocument();
      }

      // Missing collections are filled in rather than rejected, so a document
      // written by an older version keeps working.
      return { ...emptyDocument(), ...parsed };
    } catch {
      return emptyDocument();
    }
  }

  /**
   * Write to a sibling file, then rename over the target.
   *
   * `rename` is atomic within a filesystem, so an interrupted write leaves the
   * previous document intact instead of a truncated one.
   */
  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });

    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.document, null, 2)}\n`);
    renameSync(temporary, this.path);
  }
}

/** Canonical, order-independent content hash. Node's crypto, not WebCrypto. */
export function hashContent(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));

  return createHash("sha256")
    .update(serialized ?? "undefined")
    .digest("hex");
}

export function canonicalize(value: unknown): unknown {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Detaches stored state from callers so later mutation cannot reach it. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
