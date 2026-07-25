import { DesignFlowError } from "@designflow/sdk";
import type { StateStore, CheckpointState, CheckpointRecord } from "@designflow/sdk";
import {
  ensureCheckpointDir,
  readCheckpoint,
  writeCheckpoint,
  listCheckpointFiles,
} from "./store";
import { StateErrorCodes, STATE_DIR } from "./types";
import type { StoredCheckpoint } from "./types";

export class LocalStateStore implements StateStore {
  private readonly basePath: string;

  public constructor(basePath?: string) {
    this.basePath = basePath ?? STATE_DIR;
  }

  public async saveCheckpoint(
    workflowId: string,
    checkpointId: string,
    state: CheckpointState,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const timestamp = Date.now();
    const resolvedMetadata = metadata ?? {};

    const checkpoint: StoredCheckpoint = {
      checkpointId,
      workflowId,
      state,
      metadata: resolvedMetadata,
      timestamp,
    };

    await ensureCheckpointDir(this.basePath, workflowId);
    await writeCheckpoint(this.basePath, workflowId, checkpoint);
  }

  public async loadCheckpoint(
    workflowId: string,
    checkpointId: string,
  ): Promise<CheckpointState> {
    const stored = await readCheckpoint(
      this.basePath,
      workflowId,
      checkpointId,
    );

    if (stored === null) {
      throw new DesignFlowError(
        StateErrorCodes.NOT_FOUND,
        `Checkpoint not found: ${checkpointId}`,
        { workflowId, checkpointId },
      );
    }

    return stored.state;
  }

  public async listHistory(
    workflowId: string,
  ): Promise<readonly CheckpointRecord[]> {
    const checkpointIds = await listCheckpointFiles(
      this.basePath,
      workflowId,
    );

    const records: CheckpointRecord[] = [];

    for (const checkpointId of checkpointIds) {
      const stored = await readCheckpoint(
        this.basePath,
        workflowId,
        checkpointId,
      );
      if (stored !== null) {
        records.push({
          checkpointId: stored.checkpointId,
          timestamp: stored.timestamp,
          metadata: stored.metadata,
        });
      }
    }

    records.sort((a, b) => a.timestamp - b.timestamp);

    return records;
  }
}
