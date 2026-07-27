// packages/core/src/repository/in-memory-execution-repository.ts
import {
  executionRecordSchema,
  lifecycleEventSchema,
  executionCheckpointDataSchema,
} from "@designflow/sdk";
import type {
  ExecutionRepository,
  ExecutionRecord,
  LifecycleEvent,
  ExecutionCheckpointData,
} from "@designflow/sdk";
import { ExecutionRepositoryError } from "../errors";

// ── In-Memory Execution Repository ─────────────────────────────

export class InMemoryExecutionRepository implements ExecutionRepository {
  private readonly records = new Map<string, ExecutionRecord>();
  private readonly events = new Map<string, LifecycleEvent[]>();
  private readonly checkpoints = new Map<string, ExecutionCheckpointData>();

  public async create(record: ExecutionRecord): Promise<void> {
    const validated = executionRecordSchema.parse(record);

    if (this.records.has(validated.executionId)) {
      throw new ExecutionRepositoryError(
        `Execution record already exists: ${validated.executionId}`,
        { executionId: validated.executionId },
      );
    }

    this.records.set(validated.executionId, validated);
    this.events.set(validated.executionId, []);
  }

  public async update(
    executionId: string,
    patch: Partial<Omit<ExecutionRecord, "executionId">>,
  ): Promise<void> {
    const existing = this.records.get(executionId);
    if (!existing) {
      throw new ExecutionRepositoryError(
        `Execution record not found: ${executionId}`,
        { executionId },
      );
    }

    const merged = {
      ...existing,
      ...patch,
      executionId,
    };

    const validated = executionRecordSchema.parse(merged);
    this.records.set(executionId, validated);
  }

  public async get(executionId: string): Promise<ExecutionRecord | null> {
    return this.records.get(executionId) ?? null;
  }

  public async list(workflowId: string): Promise<readonly ExecutionRecord[]> {
    const results: ExecutionRecord[] = [];
    for (const record of this.records.values()) {
      if (record.workflowId === workflowId) {
        results.push(record);
      }
    }
    return results;
  }

  public async appendEvent(event: LifecycleEvent): Promise<void> {
    const validated = lifecycleEventSchema.parse(event);

    const eventList = this.events.get(validated.executionId);
    if (!eventList) {
      throw new ExecutionRepositoryError(
        `No execution record found for event: ${validated.executionId}`,
        { executionId: validated.executionId, phase: validated.phase },
      );
    }

    eventList.push(validated);
  }

  public async listEvents(executionId: string): Promise<readonly LifecycleEvent[]> {
    return this.events.get(executionId) ?? [];
  }

  public async saveCheckpoint(
    executionId: string,
    checkpoint: ExecutionCheckpointData,
  ): Promise<void> {
    const validated = executionCheckpointDataSchema.parse(checkpoint);

    if (validated.executionId !== executionId) {
      throw new ExecutionRepositoryError(
        "Checkpoint execution ID mismatch",
        {
          executionId,
          checkpointExecutionId: validated.executionId,
        },
      );
    }

    if (!this.records.has(executionId)) {
      throw new ExecutionRepositoryError(
        `Execution record not found for checkpoint: ${executionId}`,
        { executionId },
      );
    }

    this.checkpoints.set(executionId, validated);
  }

  public async getLatestCheckpoint(
    executionId: string,
  ): Promise<ExecutionCheckpointData | null> {
    return this.checkpoints.get(executionId) ?? null;
  }
}
