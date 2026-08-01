// packages/storage-file/src/store.ts
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  DesignFlowError,
  type AgentMemory,
  type AgentSession,
  type AgentTrace,
  type Artifact,
  type ArtifactRef,
  type ArtifactRelation,
  type ArtifactVersion,
  type ApprovalRequest,
  type ExecutionCheckpointData,
  type ExecutionEvent,
  type ExecutionRecord,
  type LifecycleEvent,
  type MemoryProposal,
  type ProjectContext,
  type ProjectIdentity,
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

/** How stale a lockfile has to be before it is assumed abandoned by a crashed process. */
const STALE_LOCK_THRESHOLD_MS = 30_000;

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

  /** Applies a change and persists it, holding the sibling lockfile for the duration. */
  public mutate<T>(change: (document: StoreDocument) => T): T {
    this.acquireLock();
    try {
      const result = change(this.document);
      this.write();
      return result;
    } finally {
      this.releaseLock();
    }
  }

  /** Re-reads from disk, discarding anything held in memory. */
  public reload(): void {
    this.document = this.read();
  }

  public close(): void {
    this.write();
  }

  private read(): StoreDocument {
    // A file that has simply never been written is the normal first-run case,
    // not corruption — it must keep initializing an empty document.
    if (!existsSync(this.path)) {
      return emptyDocument();
    }

    const raw = readFileSync(this.path, "utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw this.quarantine();
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw this.quarantine();
    }

    // Missing collections are filled in rather than rejected, so a document
    // written by an older version keeps working.
    return { ...emptyDocument(), ...parsed };
  }

  /**
   * Renames the unreadable file aside so its bytes are preserved rather than
   * silently discarded, and returns the error to throw for it.
   */
  private quarantine(): DesignFlowError {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.path}.corrupt-${timestamp}`;
    renameSync(this.path, backupPath);

    return new DesignFlowError(
      "ERR_STORE_CORRUPTED",
      `The store at ${this.path} could not be read as valid JSON and has been moved to ${backupPath}. A fresh store will be created; the original file was left intact for inspection or recovery.`,
      { path: this.path, backupPath },
    );
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

  private get lockPath(): string {
    return `${this.path}.lock`;
  }

  /**
   * Exclusive-create a sibling lockfile so a second process cannot interleave
   * a `mutate()` with this one and lose an update on `rename`.
   *
   * A lock left behind by a crashed process is reclaimed once, after which a
   * lock that still cannot be acquired is treated as a genuinely live writer.
   */
  private acquireLock(): void {
    mkdirSync(dirname(this.path), { recursive: true });

    if (this.tryAcquireLock()) return;

    if (this.reclaimStaleLock()) {
      if (this.tryAcquireLock()) return;
    }

    throw new DesignFlowError(
      "ERR_STORE_LOCKED",
      `The store at ${this.path} is locked by another process (lockfile: ${this.lockPath}). Wait for it to finish, or remove the lockfile if you are certain nothing else is using this store.`,
      { path: this.path, lockPath: this.lockPath },
    );
  }

  private tryAcquireLock(): boolean {
    try {
      const fd = openSync(this.lockPath, "wx");
      closeSync(fd);
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") return false;
      throw error;
    }
  }

  /** Deletes the lockfile if it is older than the stale threshold. Returns whether it did. */
  private reclaimStaleLock(): boolean {
    try {
      const { mtimeMs } = statSync(this.lockPath);
      if (Date.now() - mtimeMs < STALE_LOCK_THRESHOLD_MS) return false;

      unlinkSync(this.lockPath);
      return true;
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return false;
      throw error;
    }
  }

  private releaseLock(): void {
    try {
      unlinkSync(this.lockPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") return;
      throw error;
    }
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
