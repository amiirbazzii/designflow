import type { ArtifactRef, CheckpointRecord } from "./schemas";

export type { ExecutionContext } from "./schemas";
export { executionContextSchema } from "./schemas";

export type CheckpointState = unknown;

export interface StateStore {
  saveCheckpoint(
    workflowId: string,
    checkpointId: string,
    state: CheckpointState,
    metadata?: Record<string, unknown>,
    timestamp?: number,
  ): Promise<void>;

  loadCheckpoint(
    workflowId: string,
    checkpointId: string,
  ): Promise<CheckpointState>;

  listHistory(workflowId: string): Promise<readonly CheckpointRecord[]>;
}

export interface ArtifactStore {
  save(
    data: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<ArtifactRef>;

  get(id: string): Promise<{ artifact: ArtifactRef; data: unknown } | null>;

  exists(id: string): Promise<boolean>;
}