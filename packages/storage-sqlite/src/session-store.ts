// packages/storage-sqlite/src/session-store.ts
import type { Database } from "bun:sqlite";
import {
  DesignFlowError,
  agentSessionPatchSchema,
  agentSessionSchema,
  applySessionPatch,
  selectSessions,
  type AgentSession,
  type AgentSessionPatch,
  type SessionListFilter,
  type SessionStore,
} from "@designflow/sdk";
import { asRow } from "./execution-repository";
import { fromJson } from "./schema";

/** A caller tried to create a session under an id already in use. */
export class SessionAlreadyExistsError extends DesignFlowError {
  public constructor(sessionId: string) {
    super("ERR_SESSION_ALREADY_EXISTS", `A session already exists: ${sessionId}`, {
      sessionId,
    });
    this.name = "SessionAlreadyExistsError";
    Object.setPrototypeOf(this, SessionAlreadyExistsError.prototype);
  }
}

/** An update or read named a session this store does not have. */
export class SessionNotFoundError extends DesignFlowError {
  public constructor(sessionId: string) {
    super("ERR_SESSION_NOT_FOUND", `No such session: ${sessionId}`, { sessionId });
    this.name = "SessionNotFoundError";
    Object.setPrototypeOf(this, SessionNotFoundError.prototype);
  }
}

/**
 * An update named a version older than the one on disk.
 *
 * Refused rather than merged, the same discipline `FileSessionStore` and
 * `InMemorySessionStore` both apply — two writers racing to answer the same
 * session must not both appear to succeed.
 */
export class SessionConflictError extends DesignFlowError {
  public constructor(sessionId: string, expectedVersion: number, actualVersion: number) {
    super(
      "ERR_SESSION_CONFLICT",
      `Session ${sessionId} is at version ${actualVersion}, not ${expectedVersion}`,
      { sessionId, expectedVersion, actualVersion },
    );
    this.name = "SessionConflictError";
    Object.setPrototypeOf(this, SessionConflictError.prototype);
  }
}

/**
 * `SessionStore` backed by SQLite.
 *
 * A clarification conversation has to outlive the process that started it —
 * the whole reason the API host uses SQLite for everything else, and the one
 * gap this closes. Structurally the same adapter shape as
 * `SqliteApprovalManager`: the driver's `Database` handle is injected rather
 * than opened here, so it shares the connection (and the WAL) every other
 * SQLite-backed collaborator in the host uses.
 *
 * The full session is stored as one JSON blob, validated by
 * `agentSessionSchema` on every write and on every read — the same
 * defensive-read discipline `FileSessionStore` applies, so a hand-edited or
 * corrupted row is dropped rather than surfaced as a malformed `AgentSession`.
 * `status`, `worker_id` and `version` are duplicated into their own columns
 * purely so filtering and the concurrency check do not require parsing JSON
 * first; the JSON blob remains the source of truth for everything else.
 */
export class SqliteSessionStore implements SessionStore {
  private readonly db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  public async create(session: AgentSession): Promise<void> {
    const validated = agentSessionSchema.parse(session);

    const existing = this.db
      .query("SELECT session_id FROM sessions WHERE session_id = ?")
      .get(validated.id);

    if (existing !== null) throw new SessionAlreadyExistsError(validated.id);

    this.db
      .query(
        `INSERT INTO sessions (session_id, worker_id, status, version, updated_at, session_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        validated.id,
        validated.workerId,
        validated.status,
        validated.version,
        validated.updatedAt,
        JSON.stringify(validated),
      );
  }

  public async get(sessionId: string): Promise<AgentSession | null> {
    const row = this.db
      .query("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId);

    if (row === null) return null;

    return toSession(row);
  }

  public async update(
    sessionId: string,
    expectedVersion: number,
    patch: AgentSessionPatch,
  ): Promise<AgentSession> {
    const validatedPatch = agentSessionPatchSchema.parse(patch);

    const row = this.db
      .query("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId);

    if (row === null) throw new SessionNotFoundError(sessionId);

    const existing = toSession(row);
    if (existing === null) throw new SessionNotFoundError(sessionId);

    if (existing.version !== expectedVersion) {
      throw new SessionConflictError(sessionId, expectedVersion, existing.version);
    }

    const updated = applySessionPatch(existing, validatedPatch, existing.version + 1);

    this.db
      .query(
        `UPDATE sessions
         SET worker_id = ?, status = ?, version = ?, updated_at = ?, session_json = ?
         WHERE session_id = ?`,
      )
      .run(
        updated.workerId,
        updated.status,
        updated.version,
        updated.updatedAt,
        JSON.stringify(updated),
        sessionId,
      );

    return updated;
  }

  public async list(filters?: SessionListFilter): Promise<readonly AgentSession[]> {
    const rows = this.db.query("SELECT * FROM sessions").all();

    // Hand-edited or truncated rows are dropped rather than surfaced, the
    // same discipline `FileSessionStore.list` applies.
    const valid = rows.flatMap((row) => {
      const session = toSession(row);
      return session === null ? [] : [session];
    });

    return selectSessions(valid, filters);
  }
}

/** Parses a stored row's JSON blob, dropping anything that no longer matches the schema. */
function toSession(row: unknown): AgentSession | null {
  const record = asRow(row);
  const parsed = agentSessionSchema.safeParse(fromJson(record.session_json));

  return parsed.success ? parsed.data : null;
}
