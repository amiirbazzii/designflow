// packages/storage-sqlite/src/event-store.ts
import type { Database } from "bun:sqlite";
import { executionEventSchema } from "@designflow/sdk";
import type {
  ExecutionEvent,
  ExecutionEventHandler,
  ExecutionEventPublisher,
} from "@designflow/sdk";
import { asRow } from "./execution-repository";
import { fromJsonRecord, toJson } from "./schema";

/**
 * The raw event stream, persisted.
 *
 * Structurally satisfies the product layer's `ExecutionEventSource` without
 * importing it — one method, `listEvents` — so this package keeps its single
 * dependency on `@designflow/sdk`.
 *
 * It exists because the engine's own `ExecutionEventRepositorySubscriber`
 * persists only events that map to a lifecycle phase, which drops every
 * `artifact.*` event plus planning and reconciliation. Those are exactly the
 * events that explain what a run reused and changed, so without this table a
 * restarted process could show a run's status but not its story.
 */
export class SqliteExecutionEventStore {
  private readonly db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  /** Subscribe this to the engine's publisher to start recording. */
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

    this.db
      .query(
        `INSERT INTO execution_events (event_id, execution_id, type, timestamp, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        validated.id,
        validated.executionId,
        validated.type,
        validated.timestamp,
        toJson(validated.payload),
      );
  }

  public async listEvents(
    executionId: string,
  ): Promise<readonly ExecutionEvent[]> {
    const rows = this.db
      .query(
        "SELECT * FROM execution_events WHERE execution_id = ? ORDER BY seq ASC",
      )
      .all(executionId);

    return rows.map((row) => {
      const record = asRow(row);

      return executionEventSchema.parse({
        id: record.event_id,
        executionId: record.execution_id,
        type: record.type,
        timestamp: record.timestamp,
        payload: fromJsonRecord(record.payload_json),
      });
    });
  }
}
