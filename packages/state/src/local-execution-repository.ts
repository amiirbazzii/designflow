import { join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";
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
import { DesignFlowError } from "@designflow/sdk";

// ── Error Codes ────────────────────────────────────────────────

const ErrorCodes = {
  NOT_FOUND: "ERR_EXEC_REPO_NOT_FOUND",
  ALREADY_EXISTS: "ERR_EXEC_REPO_ALREADY_EXISTS",
  SAVE_FAILED: "ERR_EXEC_REPO_SAVE",
  LOAD_FAILED: "ERR_EXEC_REPO_LOAD",
  INVALID_ID: "ERR_EXEC_REPO_INVALID_ID",
  DIRECTORY_FAILED: "ERR_EXEC_REPO_DIRECTORY",
  ID_MISMATCH: "ERR_EXEC_REPO_ID_MISMATCH",
} as const;

// ── Helpers ────────────────────────────────────────────────────

function validateId(id: string, label: string): void {
  if (!id) {
    throw new DesignFlowError(
      ErrorCodes.INVALID_ID,
      `${label} must not be empty`,
    );
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new DesignFlowError(
      ErrorCodes.INVALID_ID,
      `${label} must not contain path traversal or separators`,
      { id },
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

// ── Directory Layout ───────────────────────────────────────────

const EXEC_DIR = ".designflow/executions";
const RECORDS_DIR = "records";
const EVENTS_DIR = "events";
const CHECKPOINTS_DIR = "checkpoints";

// ── Local Execution Repository ─────────────────────────────────

export class LocalExecutionRepository implements ExecutionRepository {
  private readonly basePath: string;

  public constructor(basePath?: string) {
    this.basePath = basePath ?? EXEC_DIR;
  }

  // ── Records ────────────────────────────────────────────────

  public async create(record: ExecutionRecord): Promise<void> {
    const validated = executionRecordSchema.parse(record);
    validateId(validated.executionId, "Execution ID");

    const filePath = this.recordPath(validated.executionId);
    const exists = await this.fileExists(filePath);

    if (exists) {
      throw new DesignFlowError(
        ErrorCodes.ALREADY_EXISTS,
        `Execution record already exists: ${validated.executionId}`,
        { executionId: validated.executionId },
      );
    }

    await this.ensureDir(this.recordsDir());
    await this.writeJson(filePath, validated);

    const eventsPath = this.eventsPath(validated.executionId);
    await this.writeJson(eventsPath, []);
  }

  public async update(
    executionId: string,
    patch: Partial<Omit<ExecutionRecord, "executionId">>,
  ): Promise<void> {
    validateId(executionId, "Execution ID");

    const filePath = this.recordPath(executionId);
    const raw = await this.readJson(filePath);

    if (raw === null) {
      throw new DesignFlowError(
        ErrorCodes.NOT_FOUND,
        `Execution record not found: ${executionId}`,
        { executionId },
      );
    }

    const existing = executionRecordSchema.parse(raw);

    const merged = {
      ...existing,
      ...patch,
      executionId,
    };

    const validated = executionRecordSchema.parse(merged);
    await this.writeJson(filePath, validated);
  }

  public async get(executionId: string): Promise<ExecutionRecord | null> {
    validateId(executionId, "Execution ID");

    const filePath = this.recordPath(executionId);
    const raw = await this.readJson(filePath);

    return raw === null ? null : executionRecordSchema.parse(raw);
  }

  public async list(workflowId: string): Promise<readonly ExecutionRecord[]> {
    const dir = this.recordsDir();
    const entries = await this.listDir(dir);

    const results: ExecutionRecord[] = [];

    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;

      const executionId = entry.replace(/\.json$/, "");
      const record = await this.get(executionId);

      if (record !== null && record.workflowId === workflowId) {
        results.push(record);
      }
    }

    return results;
  }

  // ── Events ─────────────────────────────────────────────────

  public async appendEvent(event: LifecycleEvent): Promise<void> {
    const validated = lifecycleEventSchema.parse(event);
    validateId(validated.executionId, "Execution ID");

    const eventsPath = this.eventsPath(validated.executionId);
    const raw = await this.readJson(eventsPath);

    if (raw === null) {
      throw new DesignFlowError(
        ErrorCodes.NOT_FOUND,
        `No execution record found for event: ${validated.executionId}`,
        { executionId: validated.executionId, phase: validated.phase },
      );
    }

    const events = lifecycleEventSchema.array().parse(raw);
    events.push(validated);
    await this.writeJson(eventsPath, events);
  }

  public async listEvents(executionId: string): Promise<readonly LifecycleEvent[]> {
    validateId(executionId, "Execution ID");

    const eventsPath = this.eventsPath(executionId);
    const raw = await this.readJson(eventsPath);

    if (raw === null) return [];
    return lifecycleEventSchema.array().parse(raw);
  }

  // ── Checkpoints ────────────────────────────────────────────

  public async saveCheckpoint(
    executionId: string,
    checkpoint: ExecutionCheckpointData,
  ): Promise<void> {
    const validated = executionCheckpointDataSchema.parse(checkpoint);
    validateId(executionId, "Execution ID");

    if (validated.executionId !== executionId) {
      throw new DesignFlowError(
        ErrorCodes.ID_MISMATCH,
        "Checkpoint execution ID mismatch",
        {
          executionId,
          checkpointExecutionId: validated.executionId,
        },
      );
    }

    const recordPath = this.recordPath(executionId);
    const exists = await this.fileExists(recordPath);

    if (!exists) {
      throw new DesignFlowError(
        ErrorCodes.NOT_FOUND,
        `Execution record not found for checkpoint: ${executionId}`,
        { executionId },
      );
    }

    const filePath = this.checkpointPath(executionId);
    await this.writeJson(filePath, validated);
  }

  public async getLatestCheckpoint(
    executionId: string,
  ): Promise<ExecutionCheckpointData | null> {
    validateId(executionId, "Execution ID");

    const filePath = this.checkpointPath(executionId);
    const raw = await this.readJson(filePath);

    return raw === null ? null : executionCheckpointDataSchema.parse(raw);
  }

  // ── File System Helpers ────────────────────────────────────

  private recordsDir(): string {
    return join(this.basePath, RECORDS_DIR);
  }

  private recordPath(executionId: string): string {
    return join(this.recordsDir(), `${executionId}.json`);
  }

  private eventsPath(executionId: string): string {
    return join(this.basePath, EVENTS_DIR, `${executionId}.json`);
  }

  private checkpointPath(executionId: string): string {
    return join(this.basePath, CHECKPOINTS_DIR, `${executionId}.json`);
  }

  private async ensureDir(dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      throw new DesignFlowError(
        ErrorCodes.DIRECTORY_FAILED,
        "Failed to create execution directory",
        { dir, error: String(error) },
      );
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const file = Bun.file(filePath);
      return await file.exists();
    } catch {
      return false;
    }
  }

  private async readJson(filePath: string): Promise<unknown | null> {
    try {
      const file = Bun.file(filePath);
      const exists = await file.exists();
      if (!exists) return null;
      return await file.json();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw new DesignFlowError(
        ErrorCodes.LOAD_FAILED,
        `Failed to load: ${filePath}`,
        { filePath, error: String(error) },
      );
    }
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    try {
      const dir = filePath.substring(0, filePath.lastIndexOf("/"));
      await this.ensureDir(dir);

      const tmpPath = `${filePath}.tmp`;
      const json = JSON.stringify(data, null, 2);
      await Bun.write(tmpPath, json);

      const { rename } = await import("node:fs/promises");
      await rename(tmpPath, filePath);
    } catch (error) {
      throw new DesignFlowError(
        ErrorCodes.SAVE_FAILED,
        `Failed to save: ${filePath}`,
        { filePath, error: String(error) },
      );
    }
  }

  private async listDir(dir: string): Promise<readonly string[]> {
    try {
      return await readdir(dir);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw new DesignFlowError(
        ErrorCodes.LOAD_FAILED,
        `Failed to list directory: ${dir}`,
        { dir, error: String(error) },
      );
    }
  }
}
