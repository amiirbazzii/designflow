import { join } from "node:path";
import { mkdir, readdir, rename } from "node:fs/promises";
import { DesignFlowError } from "@designflow/sdk";
import type { StoredCheckpoint } from "./types";
import { StateErrorCodes } from "./types";

function validateWorkflowId(workflowId: string): void {
  if (!workflowId) {
    throw new DesignFlowError(
      StateErrorCodes.INVALID_ID,
      "Workflow ID must not be empty",
    );
  }
  if (workflowId.includes("..")) {
    throw new DesignFlowError(
      StateErrorCodes.INVALID_ID,
      "Workflow ID must not contain path traversal sequences",
      { workflowId },
    );
  }
  if (workflowId.startsWith("/")) {
    throw new DesignFlowError(
      StateErrorCodes.INVALID_ID,
      "Workflow ID must not be an absolute path",
      { workflowId },
    );
  }
}

function validateCheckpointId(checkpointId: string): void {
  if (!checkpointId) {
    throw new DesignFlowError(
      StateErrorCodes.INVALID_ID,
      "Checkpoint ID must not be empty",
    );
  }
  if (checkpointId.includes("..")) {
    throw new DesignFlowError(
      StateErrorCodes.INVALID_ID,
      "Checkpoint ID must not contain path traversal sequences",
      { checkpointId },
    );
  }
  if (checkpointId.includes("/") || checkpointId.includes("\\")) {
    throw new DesignFlowError(
      StateErrorCodes.INVALID_ID,
      "Checkpoint ID must not contain path separators",
      { checkpointId },
    );
  }
}

function isNodeError(
  error: unknown,
): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  );
}

export function checkpointPath(
  basePath: string,
  workflowId: string,
  checkpointId: string,
): string {
  validateWorkflowId(workflowId);
  validateCheckpointId(checkpointId);
  return join(basePath, workflowId, `${checkpointId}.json`);
}

export function workflowDir(basePath: string, workflowId: string): string {
  validateWorkflowId(workflowId);
  return join(basePath, workflowId);
}

export async function ensureCheckpointDir(
  basePath: string,
  workflowId: string,
): Promise<void> {
  try {
    await mkdir(workflowDir(basePath, workflowId), { recursive: true });
  } catch (error) {
    throw new DesignFlowError(
      StateErrorCodes.DIRECTORY_FAILED,
      "Failed to create checkpoint directory",
      { workflowId, basePath, error: String(error) },
    );
  }
}

export async function readCheckpoint(
  basePath: string,
  workflowId: string,
  checkpointId: string,
): Promise<StoredCheckpoint | null> {
  try {
    const filePath = checkpointPath(basePath, workflowId, checkpointId);
    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) return null;
    return (await file.json()) as StoredCheckpoint;
  } catch (error) {
    if (error instanceof DesignFlowError) throw error;
    throw new DesignFlowError(
      StateErrorCodes.LOAD_FAILED,
      `Failed to load checkpoint: ${checkpointId}`,
      { workflowId, checkpointId, error: String(error) },
    );
  }
}

export async function writeCheckpoint(
  basePath: string,
  workflowId: string,
  checkpoint: StoredCheckpoint,
): Promise<void> {
  try {
    const filePath = checkpointPath(
      basePath,
      workflowId,
      checkpoint.checkpointId,
    );
    const tmpPath = `${filePath}.tmp`;
    const data = JSON.stringify(checkpoint);
    await Bun.write(tmpPath, data);
    await rename(tmpPath, filePath);
  } catch (error) {
    throw new DesignFlowError(
      StateErrorCodes.SAVE_FAILED,
      `Failed to save checkpoint: ${checkpoint.checkpointId}`,
      {
        workflowId,
        checkpointId: checkpoint.checkpointId,
        error: String(error),
      },
    );
  }
}

export async function listCheckpointFiles(
  basePath: string,
  workflowId: string,
): Promise<readonly string[]> {
  try {
    const dir = workflowDir(basePath, workflowId);
    const entries = await readdir(dir);
    return entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.replace(/\.json$/, ""));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw new DesignFlowError(
      StateErrorCodes.LIST_FAILED,
      `Failed to list checkpoints for workflow: ${workflowId}`,
      { workflowId, error: String(error) },
    );
  }
}
