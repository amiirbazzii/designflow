export const STATE_DIR = ".designflow/state";

export interface StoredCheckpoint {
  checkpointId: string;
  workflowId: string;
  state: unknown;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export const StateErrorCodes = {
  SAVE_FAILED: "ERR_STATE_SAVE",
  LOAD_FAILED: "ERR_STATE_LOAD",
  LIST_FAILED: "ERR_STATE_LIST",
  DIRECTORY_FAILED: "ERR_STATE_DIRECTORY",
  NOT_FOUND: "ERR_STATE_NOT_FOUND",
  INVALID_ID: "ERR_STATE_INVALID_ID",
} as const;
