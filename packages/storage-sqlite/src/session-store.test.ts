// packages/storage-sqlite/src/session-store.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { DesignFlowError, type AgentSession } from "@designflow/sdk";
import { openDatabase } from "./schema";
import { SqliteSessionStore } from "./session-store";

/**
 * `SqliteSessionStore` tests.
 *
 * Mirrors `storage.test.ts`'s shape: each adapter honours the contract it
 * implements, and reopening the file recovers what was written. Sessions are
 * the one piece of state the API host still kept in memory before this store
 * existed, so the restart case here is not incidental — it is what this
 * store is for.
 */

const workspaces: string[] = [];
const openDbs: Database[] = [];

function newPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-session-store-"));
  workspaces.push(dir);
  return join(dir, "test.sqlite");
}

function open(path: string): Database {
  const db = openDatabase(path);
  openDbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const expectCode = async (
  operation: Promise<unknown>,
  code: string,
): Promise<void> => {
  try {
    await operation;
    throw new Error(`Expected rejection with ${code}`);
  } catch (error) {
    if (!(error instanceof DesignFlowError)) throw error;
    expect(error.code).toBe(code);
  }
};

function session(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: "session-1",
    workerId: "worker-1",
    agentId: "agent-1",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    turnCount: 0,
    originalRequest: "build me a thing",
    answers: [],
    traceIds: [],
    ...overrides,
  };
}

describe("SqliteSessionStore", () => {
  test("round-trips a session", async () => {
    const store = new SqliteSessionStore(open(newPath()));

    await store.create(session());

    const found = await store.get("session-1");
    expect(found?.workerId).toBe("worker-1");
    expect(found?.originalRequest).toBe("build me a thing");
    expect(found?.status).toBe("active");
  });

  test("returns null for an unknown id", async () => {
    const store = new SqliteSessionStore(open(newPath()));

    expect(await store.get("missing")).toBeNull();
  });

  test("refuses to create a session under an id already in use", async () => {
    const store = new SqliteSessionStore(open(newPath()));
    await store.create(session());

    await expectCode(store.create(session()), "ERR_SESSION_ALREADY_EXISTS");
  });

  test("applies a patch and increments the version", async () => {
    const store = new SqliteSessionStore(open(newPath()));
    await store.create(session());

    const updated = await store.update("session-1", 1, {
      status: "waiting_for_user",
      updatedAt: "2026-01-01T00:01:00.000Z",
      currentQuestion: "what should the button say?",
    });

    expect(updated.version).toBe(2);
    expect(updated.status).toBe("waiting_for_user");
    expect(updated.currentQuestion).toBe("what should the button say?");

    const reread = await store.get("session-1");
    expect(reread?.version).toBe(2);
    expect(reread?.currentQuestion).toBe("what should the button say?");
  });

  test("rejects an update against a stale version", async () => {
    const store = new SqliteSessionStore(open(newPath()));
    await store.create(session());

    await store.update("session-1", 1, { updatedAt: "2026-01-01T00:01:00.000Z" });

    await expectCode(
      store.update("session-1", 1, { updatedAt: "2026-01-01T00:02:00.000Z" }),
      "ERR_SESSION_CONFLICT",
    );
  });

  test("rejects an update against an unknown session", async () => {
    const store = new SqliteSessionStore(open(newPath()));

    await expectCode(
      store.update("missing", 1, { updatedAt: "2026-01-01T00:01:00.000Z" }),
      "ERR_SESSION_NOT_FOUND",
    );
  });

  test("lists sessions filtered by status and workerId, newest first", async () => {
    const store = new SqliteSessionStore(open(newPath()));

    await store.create(
      session({
        id: "session-a",
        workerId: "worker-1",
        status: "active",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await store.create(
      session({
        id: "session-b",
        workerId: "worker-1",
        status: "waiting_for_user",
        updatedAt: "2026-01-01T00:02:00.000Z",
      }),
    );
    await store.create(
      session({
        id: "session-c",
        workerId: "worker-2",
        status: "waiting_for_user",
        updatedAt: "2026-01-01T00:01:00.000Z",
      }),
    );

    const waiting = await store.list({ status: "waiting_for_user" });
    expect(waiting.map((s) => s.id)).toEqual(["session-b", "session-c"]);

    const worker1 = await store.list({ workerId: "worker-1" });
    expect(worker1.map((s) => s.id)).toEqual(["session-b", "session-a"]);
  });

  test("survives reopening the database", async () => {
    const path = newPath();

    const first = new SqliteSessionStore(open(path));
    await first.create(
      session({ status: "waiting_for_user", currentQuestion: "which color?" }),
    );
    openDbs.pop()?.close();

    // The whole point of this store: a clarification conversation outlives
    // the process that started it.
    const second = new SqliteSessionStore(open(path));
    const found = await second.get("session-1");

    expect(found?.status).toBe("waiting_for_user");
    expect(found?.currentQuestion).toBe("which color?");
  });

  test("drops a corrupt row instead of throwing", async () => {
    const db = open(newPath());
    const store = new SqliteSessionStore(db);

    await store.create(session());

    // Simulate a hand-edited or truncated row landing directly in the table.
    db.query(
      `INSERT INTO sessions (session_id, worker_id, status, version, updated_at, session_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("corrupt-session", "worker-1", "active", 1, "2026-01-01T00:00:00.000Z", "{not valid json");

    expect(await store.get("corrupt-session")).toBeNull();

    const listed = await store.list();
    expect(listed.map((s) => s.id)).toEqual(["session-1"]);
  });
});
