// packages/storage-sqlite/src/execution-repository.ts
import type { Database } from "bun:sqlite";
import {
  executionCheckpointDataSchema,
  executionRecordSchema,
  lifecycleEventSchema,
} from "@designflow/sdk";
import type {
  ExecutionCheckpointData,
  ExecutionRecord,
  ExecutionRepository,
  LifecycleEvent,
} from "@designflow/sdk";
import { fromJson, fromJsonRecord, toJson } from "./schema";

/**
 * `ExecutionRepository` backed by SQLite.
 *
 * A straight adapter: same contract, same semantics, durable rows. Every read
 * re-parses through the SDK schema, so a hand-edited or migrated database
 * cannot feed the engine a shape it does not expect.
 */
export class SqliteExecutionRepository implements ExecutionRepository {
  private readonly db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  public async create(record: ExecutionRecord): Promise<void> {
    const validated = executionRecordSchema.parse(record);

    this.db
      .query(
        `INSERT OR REPLACE INTO executions
           (execution_id, workflow_id, status, started_at, completed_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        validated.executionId,
        validated.workflowId,
        validated.status,
        validated.startedAt,
        validated.completedAt ?? null,
        toJson(validated.metadata),
      );
  }

  public async update(
    executionId: string,
    patch: Partial<Omit<ExecutionRecord, "executionId">>,
  ): Promise<void> {
    const existing = await this.get(executionId);
    if (existing === null) return;

    // Read-modify-write rather than a partial UPDATE: the record is small, and
    // this keeps one validation path for everything that lands in the table.
    await this.create({ ...existing, ...patch, executionId });
  }

  public async get(executionId: string): Promise<ExecutionRecord | null> {
    const row = this.db
      .query("SELECT * FROM executions WHERE execution_id = ?")
      .get(executionId);

    return row === null ? null : this.toRecord(row);
  }

  public async list(workflowId: string): Promise<readonly ExecutionRecord[]> {
    const rows = this.db
      .query(
        "SELECT * FROM executions WHERE workflow_id = ? ORDER BY started_at DESC",
      )
      .all(workflowId);

    return rows.map((row) => this.toRecord(row));
  }

  /** Every execution, newest first. Powers the history view. */
  public async listAll(limit = 50): Promise<readonly ExecutionRecord[]> {
    const rows = this.db
      .query("SELECT * FROM executions ORDER BY started_at DESC LIMIT ?")
      .all(limit);

    return rows.map((row) => this.toRecord(row));
  }

  public async appendEvent(event: LifecycleEvent): Promise<void> {
    const validated = lifecycleEventSchema.parse(event);

    this.db
      .query(
        `INSERT INTO lifecycle_events (execution_id, phase, timestamp, metadata_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        validated.executionId,
        validated.phase,
        validated.timestamp,
        toJson(validated.metadata),
      );
  }

  public async listEvents(
    executionId: string,
  ): Promise<readonly LifecycleEvent[]> {
    const rows = this.db
      .query(
        "SELECT * FROM lifecycle_events WHERE execution_id = ? ORDER BY seq ASC",
      )
      .all(executionId);

    return rows.map((row) => {
      const record = asRow(row);
      return lifecycleEventSchema.parse({
        executionId: record.execution_id,
        phase: record.phase,
        timestamp: record.timestamp,
        metadata: fromJsonRecord(record.metadata_json),
      });
    });
  }

  public async saveCheckpoint(
    executionId: string,
    checkpoint: ExecutionCheckpointData,
  ): Promise<void> {
    const validated = executionCheckpointDataSchema.parse(checkpoint);

    this.db
      .query(
        `INSERT INTO checkpoints (execution_id, phase, timestamp, state_json, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        executionId,
        validated.phase,
        validated.timestamp,
        toJson(validated.state),
        toJson(validated.metadata),
      );
  }

  public async getLatestCheckpoint(
    executionId: string,
  ): Promise<ExecutionCheckpointData | null> {
    const row = this.db
      .query(
        "SELECT * FROM checkpoints WHERE execution_id = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(executionId);

    if (row === null) return null;

    const record = asRow(row);

    return executionCheckpointDataSchema.parse({
      executionId: record.execution_id,
      phase: record.phase,
      timestamp: record.timestamp,
      state: fromJson(record.state_json),
      metadata: fromJsonRecord(record.metadata_json),
    });
  }

  private toRecord(row: unknown): ExecutionRecord {
    const record = asRow(row);

    return executionRecordSchema.parse({
      executionId: record.execution_id,
      workflowId: record.workflow_id,
      status: record.status,
      startedAt: record.started_at,
      ...(record.completed_at !== null && record.completed_at !== undefined
        ? { completedAt: record.completed_at }
        : {}),
      metadata: fromJsonRecord(record.metadata_json),
    });
  }
}

/**
 * Narrows a driver row to an indexable shape.
 *
 * `bun:sqlite` returns `unknown` per row; every field is re-validated by a Zod
 * schema immediately after, so this only makes the columns reachable — it
 * asserts nothing about their contents.
 */
export function asRow(row: unknown): Record<string, unknown> {
  return typeof row === "object" && row !== null && !Array.isArray(row)
    ? { ...row }
    : {};
}
