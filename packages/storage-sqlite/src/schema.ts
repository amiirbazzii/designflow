// packages/storage-sqlite/src/schema.ts
import { Database } from "bun:sqlite";

/**
 * The MVP's durable store.
 *
 * SQLite via `bun:sqlite` — already in the runtime, so persistence costs no
 * new dependency and a database is one file the reader can delete. Every table
 * here backs a contract that already existed; nothing about how executions or
 * artifacts *work* changed, only where the rows live.
 *
 * JSON columns hold anything the SDK already models as an opaque bag
 * (`metadata`, `payload`, `state`). Normalising those would mean this package
 * knowing what is inside them, which is precisely what the schemas are for.
 */
export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true });

  // Durability over raw speed: an MVP that loses the last write on a crash is
  // worse than one that is slightly slower.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  migrate(db);

  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS executions (
      execution_id  TEXT PRIMARY KEY,
      workflow_id   TEXT NOT NULL,
      status        TEXT NOT NULL,
      started_at    INTEGER NOT NULL,
      completed_at  INTEGER,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_executions_workflow
      ON executions (workflow_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS lifecycle_events (
      seq           INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id  TEXT NOT NULL,
      phase         TEXT NOT NULL,
      timestamp     INTEGER NOT NULL,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_lifecycle_execution
      ON lifecycle_events (execution_id, seq);

    CREATE TABLE IF NOT EXISTS checkpoints (
      seq           INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id  TEXT NOT NULL,
      phase         TEXT NOT NULL,
      timestamp     INTEGER NOT NULL,
      state_json    TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoints_execution
      ON checkpoints (execution_id, seq);

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id   TEXT PRIMARY KEY,
      execution_id  TEXT NOT NULL,
      workflow_id   TEXT NOT NULL,
      status        TEXT NOT NULL,
      reason        TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      resolved_at   INTEGER,
      expires_at    INTEGER,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_approvals_execution
      ON approvals (execution_id);

    -- The raw event stream. The engine's own subscriber drops artifact.* and
    -- planning events, so the product layer keeps its own record; persisting
    -- it here is what lets narration and timelines survive a restart.
    CREATE TABLE IF NOT EXISTS execution_events (
      seq          INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id     TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      type         TEXT NOT NULL,
      timestamp    INTEGER NOT NULL,
      payload_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_execution
      ON execution_events (execution_id, seq);

    CREATE TABLE IF NOT EXISTS artifacts (
      artifact_id     TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      version         INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      metadata_json   TEXT NOT NULL,
      provenance_json TEXT
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      artifact_id   TEXT NOT NULL,
      version       INTEGER NOT NULL,
      hash          TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      metadata_json TEXT,
      PRIMARY KEY (artifact_id, version)
    );

    CREATE TABLE IF NOT EXISTS artifact_relations (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation  TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation)
    );

    -- Payload bytes, content-addressed. Kept apart from the registry so the
    -- identity tables stay small and a future object store can replace this
    -- one table.
    CREATE TABLE IF NOT EXISTS artifact_payloads (
      payload_id TEXT PRIMARY KEY,
      ref_json   TEXT NOT NULL,
      data_json  TEXT NOT NULL
    );

    -- One row per clarification conversation. The full session is kept as one
    -- JSON blob (\`session_json\`) rather than normalised columns — the same
    -- reasoning \`metadata_json\` elsewhere in this file already documents,
    -- except here the *entire* record is the opaque bag the SDK already
    -- validates end to end via \`agentSessionSchema\`. \`status\` and
    -- \`worker_id\` are duplicated into their own columns purely so
    -- \`SessionListFilter\` can be applied with a WHERE clause instead of a
    -- full table scan; \`version\` is duplicated so optimistic concurrency
    -- can be checked without parsing JSON first.
    CREATE TABLE IF NOT EXISTS sessions (
      session_id   TEXT PRIMARY KEY,
      worker_id    TEXT NOT NULL,
      status       TEXT NOT NULL,
      version      INTEGER NOT NULL,
      updated_at   TEXT NOT NULL,
      session_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_worker_status
      ON sessions (worker_id, status);
  `);

  // A database created before `expires_at` existed has an `approvals` table
  // missing the column outright — `CREATE TABLE IF NOT EXISTS` above is a
  // no-op against it, since the table already exists. Added defensively
  // rather than as a numbered migration: the column is nullable, every read
  // already tolerates it being absent (`fromJsonRecord`-style optional
  // handling), and a second run against a database that already has it is a
  // harmless no-op.
  addColumnIfMissing(db, "approvals", "expires_at", "INTEGER");
}

function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  type: string,
): void {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((existing) => existing.name === column)) return;

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** JSON helpers. `undefined` round-trips as SQL NULL rather than "undefined". */
export function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function fromJson(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fromJsonRecord(value: unknown): Record<string, unknown> {
  const parsed = fromJson(value);
  return isRecord(parsed) ? parsed : {};
}
