import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImplementationError } from "./errors";

const LOCK_STALE_AFTER_MS = 30_000;

export interface ProjectWriteLockRecord {
  readonly lockId: string;
  readonly projectId: string;
  readonly rootIdentity: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

export interface ProjectWriteLock {
  readonly record: ProjectWriteLockRecord;
  release(): Promise<void>;
}

/**
 * Acquires the single write boundary for a registered project.
 *
 * The lock lives in DesignFlow state, never in the project. `wx` makes the
 * ownership claim atomic across OS processes. A dead or stale owner is
 * reclaimed only after its record is inspected; no process is terminated by
 * this capability.
 */
export async function acquireProjectWriteLock(
  projectId: string,
  rootIdentity: string,
  stateDirectory: string,
): Promise<ProjectWriteLock> {
  await mkdir(stateDirectory, { recursive: true });
  const lockPath = join(stateDirectory, `project-write-${rootIdentity}.lock`);
  const record: ProjectWriteLockRecord = {
    lockId: randomUUID(),
    projectId,
    rootIdentity,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await writeFile(handle, JSON.stringify(record), "utf8");
      } finally {
        await handle.close();
      }
      return {
        record,
        release: async () => {
          try {
            const current = JSON.parse(await readFile(lockPath, "utf8")) as Partial<ProjectWriteLockRecord>;
            if (current.lockId === record.lockId) await unlink(lockPath);
          } catch (error) {
            if (!isMissingFile(error)) throw error;
          }
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error) || attempt === 1) {
        if (isAlreadyExists(error)) {
          throw new ImplementationError(
            "ERR_PROJECT_WRITE_LOCKED",
            "Another DesignFlow process owns this project's write lock.",
            { projectId, rootIdentity },
          );
        }
        throw error;
      }

      if (!(await reclaimIfDeadOrStale(lockPath))) {
        throw new ImplementationError(
          "ERR_PROJECT_WRITE_LOCKED",
          "Another DesignFlow process owns this project's write lock.",
          { projectId, rootIdentity },
        );
      }
    }
  }

  throw new ImplementationError("ERR_PROJECT_WRITE_LOCKED", "Another DesignFlow process owns this project's write lock.", { projectId, rootIdentity });
}

async function reclaimIfDeadOrStale(lockPath: string): Promise<boolean> {
  try {
    const record = JSON.parse(await readFile(lockPath, "utf8")) as Partial<ProjectWriteLockRecord>;
    const acquiredAt = Date.parse(record.acquiredAt ?? "");
    const stale = !Number.isFinite(acquiredAt) || Date.now() - acquiredAt > LOCK_STALE_AFTER_MS;
    const dead = typeof record.pid !== "number" || !isProcessAlive(record.pid);
    if (!stale && !dead) return false;
    await unlink(lockPath);
    return true;
  } catch (error) {
    return isMissingFile(error);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
