// packages/storage-file/src/recovery.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignFlowError } from "@designflow/sdk";
import { FileStore } from "./store";

/**
 * Two things a single-machine, single-user store still owes a person:
 * evidence when its file is unreadable, rather than a silent reset to
 * empty, and protection against two processes racing on the same file,
 * rather than a silent lost update.
 */

const workspaces: string[] = [];

function newPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-recovery-"));
  workspaces.push(dir);
  return join(dir, "store.json");
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`Expected throw with code ${code}`);
  } catch (error) {
    if (!(error instanceof DesignFlowError)) throw error;
    expect(error.code).toBe(code);
  }
}

afterEach(() => {
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("corruption detection", () => {
  test("a file that exists but is not valid JSON is quarantined, not silently reset", () => {
    const path = newPath();
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{ this is not json ");

    expectCode(() => new FileStore(path), "ERR_STORE_CORRUPTED");

    // The original file is gone from its original path...
    expect(existsSync(path)).toBe(false);

    // ...but its bytes were preserved next to it, not discarded.
    const dir = join(path, "..");
    const backupName = readdirSync(dir).find((name) =>
      name.startsWith("store.json.corrupt-"),
    );
    expect(backupName).toBeDefined();

    const backupContent = readFileSync(join(dir, backupName as string), "utf8");
    expect(backupContent).toBe("{ this is not json ");
  });

  test("a file that parses but is not a document shape (e.g. an array) is also quarantined", () => {
    const path = newPath();
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "[1, 2, 3]");

    expectCode(() => new FileStore(path), "ERR_STORE_CORRUPTED");
  });

  test("a path that has never existed still initializes an empty document, no error", () => {
    const path = newPath();

    const store = new FileStore(path);

    expect(store.data.version).toBe(1);
    expect(store.data.executions).toEqual({});
  });
});

describe("locking", () => {
  test("a live lockfile makes mutate() throw ERR_STORE_LOCKED instead of racing", () => {
    const path = newPath();
    const store = new FileStore(path);

    // Simulate a concurrent writer: pre-create a fresh lockfile, as another
    // `FileStore.mutate()` in another process would have while it works.
    const lockPath = `${path}.lock`;
    closeSync(openSync(lockPath, "wx"));

    expectCode(() => {
      store.mutate((document) => {
        document.version = 2;
      });
    }, "ERR_STORE_LOCKED");

    // Nothing was written — the in-memory change never reached disk.
    expect(existsSync(path)).toBe(false);
  });

  test("a stale lockfile is reclaimed and the mutation succeeds", () => {
    const path = newPath();
    const store = new FileStore(path);

    const lockPath = `${path}.lock`;
    closeSync(openSync(lockPath, "wx"));

    // Back-date it well past the stale threshold.
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    store.mutate((document) => {
      document.version = 2;
    });

    expect(existsSync(lockPath)).toBe(false);
    const reloaded = new FileStore(path);
    expect(reloaded.data.version).toBe(2);
  });

  test("the lockfile is released after a successful mutation", () => {
    const path = newPath();
    const store = new FileStore(path);

    store.mutate((document) => {
      document.version = 2;
    });

    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  test("the lockfile is released even when the mutation throws", () => {
    const path = newPath();
    const store = new FileStore(path);

    expect(() =>
      store.mutate(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(existsSync(`${path}.lock`)).toBe(false);
  });
});
