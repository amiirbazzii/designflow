// packages/storage-file/src/storage.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignFlowError } from "@designflow/sdk";
import { FileStore } from "./store";
import {
  FileApprovalManager,
  FileArtifactStore,
  FileExecutionEventStore,
  FileExecutionRepository,
  FileSessionStore,
  FileTraceStore,
} from "./adapters";

/**
 * File-store adapter tests.
 *
 * Two claims are under test: each adapter honours the contract it implements,
 * and a *new* `FileStore` over the same path recovers what an earlier one
 * wrote. The second is the only reason this package exists — a CLI command is
 * always a fresh process.
 */

const workspaces: string[] = [];

function newPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-file-"));
  workspaces.push(dir);
  return join(dir, "store.json");
}

afterEach(() => {
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

// ── Execution repository ────────────────────────────────────────

describe("FileExecutionRepository", () => {
  test("round-trips a record", async () => {
    const repo = new FileExecutionRepository(new FileStore(newPath()));

    await repo.create({
      executionId: "exec-1",
      workflowId: "wf",
      status: "running",
      startedAt: 1_000,
      metadata: { environment: "staging" },
    });

    expect((await repo.get("exec-1"))?.metadata?.environment).toBe("staging");
  });

  test("merges a patch rather than replacing the record", async () => {
    const repo = new FileExecutionRepository(new FileStore(newPath()));

    await repo.create({
      executionId: "exec-1",
      workflowId: "wf",
      status: "running",
      startedAt: 1_000,
      metadata: { keep: true },
    });

    await repo.update("exec-1", { status: "completed", completedAt: 2_000 });

    const record = await repo.get("exec-1");
    expect(record?.status).toBe("completed");
    // Metadata carries the lineage and input a resume needs.
    expect(record?.metadata?.keep).toBe(true);
  });

  test("recovers from disk in a new store", async () => {
    const path = newPath();

    const first = new FileStore(path);
    await new FileExecutionRepository(first).create({
      executionId: "exec-1",
      workflowId: "wf",
      status: "completed",
      startedAt: 1_000,
    });
    first.close();

    // A second CLI invocation shares nothing but the file.
    const second = new FileExecutionRepository(new FileStore(path));
    expect((await second.get("exec-1"))?.status).toBe("completed");
  });

  test("lists a workflow's runs newest first", async () => {
    const repo = new FileExecutionRepository(new FileStore(newPath()));

    for (const [id, startedAt] of [
      ["exec-1", 1_000],
      ["exec-2", 3_000],
      ["exec-3", 2_000],
    ] as const) {
      await repo.create({
        executionId: id,
        workflowId: "wf",
        status: "completed",
        startedAt,
      });
    }

    expect((await repo.list("wf")).map((r) => r.executionId)).toEqual([
      "exec-2",
      "exec-3",
      "exec-1",
    ]);
  });

  test("lists every workflow's runs newest first", async () => {
    const repo = new FileExecutionRepository(new FileStore(newPath()));

    await repo.create({
      executionId: "a",
      workflowId: "wf-1",
      status: "completed",
      startedAt: 1_000,
    });
    await repo.create({
      executionId: "b",
      workflowId: "wf-2",
      status: "completed",
      startedAt: 2_000,
    });

    expect((await repo.listAll()).map((r) => r.executionId)).toEqual(["b", "a"]);
  });

  test("returns the latest checkpoint", async () => {
    const repo = new FileExecutionRepository(new FileStore(newPath()));

    for (const phase of ["started", "executing", "completed"]) {
      await repo.saveCheckpoint("exec-1", {
        executionId: "exec-1",
        phase,
        timestamp: 1_000,
        state: { phase },
      });
    }

    expect((await repo.getLatestCheckpoint("exec-1"))?.phase).toBe("completed");
  });

  test("returns null for anything unknown", async () => {
    const repo = new FileExecutionRepository(new FileStore(newPath()));

    expect(await repo.get("missing")).toBeNull();
    expect(await repo.getLatestCheckpoint("missing")).toBeNull();
  });
});

// ── Approvals ───────────────────────────────────────────────────

describe("FileApprovalManager", () => {
  test("creates and settles a request", async () => {
    const approvals = new FileApprovalManager(new FileStore(newPath()));

    const request = await approvals.createRequest("exec-1", "wf", "writes files");
    const approved = await approvals.approve(request.id, "looks right");

    expect(approved.status).toBe("approved");
    expect(approved.metadata?.comment).toBe("looks right");
  });

  test("survives so a person can answer later", async () => {
    const path = newPath();

    const first = new FileStore(path);
    const request = await new FileApprovalManager(first).createRequest(
      "exec-1",
      "wf",
      "writes files",
    );
    first.close();

    const second = new FileApprovalManager(new FileStore(path));
    expect((await second.approve(request.id)).status).toBe("approved");
  });

  test("refuses to re-decide a settled approval", async () => {
    const approvals = new FileApprovalManager(new FileStore(newPath()));
    const request = await approvals.createRequest("exec-1", "wf", "why");

    await approvals.reject(request.id);

    await expectCode(
      approvals.approve(request.id),
      "ERR_APPROVAL_STATE_TRANSITION",
    );
  });

  test("rejects an unknown approval", async () => {
    const approvals = new FileApprovalManager(new FileStore(newPath()));

    await expectCode(approvals.approve("missing"), "ERR_APPROVAL_NOT_FOUND");
  });

  test("an expired pending approval cannot authorize or refuse execution", async () => {
    const approvals = new FileApprovalManager(new FileStore(newPath()));
    const request = await approvals.createRequest("exec-1", "wf", "writes files", Date.now() - 1);

    await expectCode(approvals.approve(request.id), "ERR_APPROVAL_EXPIRED");
    await expectCode(approvals.reject(request.id), "ERR_APPROVAL_EXPIRED");
  });

  test("expireStale marks stale pending approvals and never touches a decided one, idempotently", async () => {
    const path = newPath();
    const approvals = new FileApprovalManager(new FileStore(path));

    const stale = await approvals.createRequest("exec-1", "wf", "writes files", Date.now() - 1);
    const fresh = await approvals.createRequest("exec-2", "wf", "writes files", Date.now() + 100_000);
    const decided = await approvals.createRequest("exec-3", "wf", "writes files", Date.now() + 50);
    await approvals.approve(decided.id);

    const first = await approvals.expireStale(Date.now());
    expect(first.map((request) => request.id)).toEqual([stale.id]);

    expect((await approvals.get(stale.id))?.status).toBe("expired");
    expect((await approvals.get(fresh.id))?.status).toBe("pending");
    expect((await approvals.get(decided.id))?.status).toBe("approved");

    const second = await approvals.expireStale(Date.now());
    expect(second).toEqual([]);
  });
});

// ── Event store ─────────────────────────────────────────────────

describe("FileExecutionEventStore", () => {
  test("records the raw stream in publish order", async () => {
    const store = new FileExecutionEventStore(new FileStore(newPath()));

    for (const [index, type] of [
      "execution.started",
      "artifact.created",
      "execution.completed",
    ].entries()) {
      store.append({
        id: `evt-${index}`,
        executionId: "exec-1",
        type,
        timestamp: 1_000 + index,
      });
    }

    // artifact.* is exactly what the engine's own subscriber drops.
    expect((await store.listEvents("exec-1")).map((e) => e.type)).toEqual([
      "execution.started",
      "artifact.created",
      "execution.completed",
    ]);
  });

  test("keeps executions apart and survives a restart", async () => {
    const path = newPath();

    const first = new FileStore(path);
    const writer = new FileExecutionEventStore(first);
    writer.append({
      id: "a",
      executionId: "exec-1",
      type: "execution.completed",
      timestamp: 1,
      payload: { artifactCount: 5 },
    });
    writer.append({
      id: "b",
      executionId: "exec-2",
      type: "execution.started",
      timestamp: 2,
    });
    first.close();

    const second = new FileExecutionEventStore(new FileStore(path));

    expect((await second.listEvents("exec-1"))[0]?.payload?.artifactCount).toBe(5);
    expect(await second.listEvents("exec-2")).toHaveLength(1);
  });
});

// ── Artifact store ──────────────────────────────────────────────

describe("FileArtifactStore", () => {
  test("registers an artifact with version 1 and provenance", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));

    const artifact = await store.createArtifact({
      id: "ui-ir",
      type: "ui.ir",
      metadata: {},
      provenance: {
        executionId: "exec-1",
        workflowId: "wf",
        capabilityId: "cap-lower",
      },
    });

    expect(artifact.version).toBe(1);
    expect((await store.getVersion("ui-ir", 1))?.hash.length).toBe(64);
    expect((await store.getArtifact("ui-ir"))?.provenance?.capabilityId).toBe(
      "cap-lower",
    );
  });

  test("advances only the latest-version pointer", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));
    await store.createArtifact({ id: "a", type: "t", metadata: { n: 1 } });

    await store.createVersion("a", { n: 2 });

    expect((await store.getArtifact("a"))?.version).toBe(2);
    // Existing version records are never rewritten.
    expect((await store.getVersion("a", 1))?.metadata).toEqual({ n: 1 });
  });

  test("rejects a duplicate registration", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));
    await store.createArtifact({ id: "a", type: "t", metadata: {} });

    await expectCode(
      store.createArtifact({ id: "a", type: "t", metadata: {} }),
      "ERR_ARTIFACT_EXISTS",
    );
  });

  test("content-addresses payloads regardless of key order", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));

    const first = await store.save({ a: 1, b: 2 });
    const second = await store.save({ b: 2, a: 1 });

    expect(second.id).toBe(first.id);
    expect((await store.get(first.id))?.data).toEqual({ a: 1, b: 2 });
    expect(await store.exists(first.id)).toBe(true);
  });

  test("walks lineage in both directions", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));

    for (const id of ["figma", "ui-ir", "code"]) {
      await store.createArtifact({ id, type: "t", metadata: {} });
    }

    await store.addRelation({
      sourceArtifactId: "ui-ir",
      targetArtifactId: "figma",
      relation: "derived_from",
    });
    await store.addRelation({
      sourceArtifactId: "code",
      targetArtifactId: "ui-ir",
      relation: "generated_from",
    });

    expect((await store.getLineage("code")).ancestors).toEqual([
      "ui-ir",
      "figma",
    ]);
    expect((await store.getLineage("figma")).descendants).toEqual([
      "ui-ir",
      "code",
    ]);
  });

  test("rejects a cycle across mixed lineage relations", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));

    for (const id of ["a", "b", "c"]) {
      await store.createArtifact({ id, type: "t", metadata: {} });
    }

    await store.addRelation({
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "derived_from",
    });
    await store.addRelation({
      sourceArtifactId: "b",
      targetArtifactId: "c",
      relation: "generated_from",
    });

    // No single relation type closes the loop, but the lineage graph is cyclic.
    await expectCode(
      store.addRelation({
        sourceArtifactId: "c",
        targetArtifactId: "a",
        relation: "derived_from",
      }),
      "ERR_ARTIFACT_CYCLE",
    );
  });

  test("allows a supersession recorded from both sides", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));

    for (const id of ["old", "new"]) {
      await store.createArtifact({ id, type: "t", metadata: {} });
    }

    await store.addRelation({
      sourceArtifactId: "new",
      targetArtifactId: "old",
      relation: "derived_from",
    });
    await store.addRelation({
      sourceArtifactId: "old",
      targetArtifactId: "new",
      relation: "replaced_by",
    });

    expect((await store.getLineage("new")).relations).toHaveLength(2);
  });

  test("rejects a relation with an unregistered endpoint", async () => {
    const store = new FileArtifactStore(new FileStore(newPath()));
    await store.createArtifact({ id: "a", type: "t", metadata: {} });

    await expectCode(
      store.addRelation({
        sourceArtifactId: "a",
        targetArtifactId: "ghost",
        relation: "derived_from",
      }),
      "ERR_ARTIFACT_NOT_FOUND",
    );
  });

  test("publishes artifact events for the product layer", async () => {
    const published: string[] = [];

    const store = new FileArtifactStore(new FileStore(newPath()), {
      eventPublisher: {
        publish: async (event) => {
          published.push(event.type);
        },
        subscribe: () => {},
        unsubscribe: () => {},
      },
    });

    await store.createArtifact({
      id: "a",
      type: "t",
      metadata: {},
      provenance: { executionId: "exec-1", workflowId: "wf" },
    });

    // Without artifact.created the product layer reports a run with no
    // artifacts, however many are on disk.
    expect(published).toEqual(["artifact.created", "artifact.version_created"]);
  });

  test("stays silent for an artifact registered outside an execution", async () => {
    const published: string[] = [];

    const store = new FileArtifactStore(new FileStore(newPath()), {
      eventPublisher: {
        publish: async (event) => {
          published.push(event.type);
        },
        subscribe: () => {},
        unsubscribe: () => {},
      },
    });

    await store.createArtifact({ id: "a", type: "t", metadata: {} });

    expect(published).toEqual([]);
  });

  test("survives a restart with lineage intact", async () => {
    const path = newPath();

    const first = new FileStore(path);
    const writer = new FileArtifactStore(first);
    await writer.createArtifact({ id: "figma", type: "t", metadata: {} });
    await writer.createArtifact({ id: "ui-ir", type: "t", metadata: {} });
    await writer.addRelation({
      sourceArtifactId: "ui-ir",
      targetArtifactId: "figma",
      relation: "derived_from",
    });
    first.close();

    const second = new FileArtifactStore(new FileStore(path));

    expect((await second.getLineage("ui-ir")).ancestors).toEqual(["figma"]);
  });
});

// ── Durability ──────────────────────────────────────────────────

describe("FileStore", () => {
  test("starts empty when the file does not exist", () => {
    const store = new FileStore(newPath());

    expect(store.data.executions).toEqual({});
  });

  test("a corrupt file is quarantined and reported, not silently treated as empty", async () => {
    const path = newPath();
    await Bun.write(path, "{ not json");

    // A broken store must not look like an empty one — that would hide data
    // loss from the person it happened to. See recovery.test.ts for the full
    // corruption/locking contract.
    await expectCode(
      (async () => new FileStore(path))(),
      "ERR_STORE_CORRUPTED",
    );
  });

  test("fills in collections missing from an older document", () => {
    const path = newPath();
    Bun.write(path, JSON.stringify({ version: 1, executions: {} }));

    const store = new FileStore(path);

    expect(store.data.relations).toEqual([]);
    expect(store.data.payloads).toEqual({});
  });
});

// ── Agent traces ────────────────────────────────────────────────

describe("FileTraceStore", () => {
  const TRACE = {
    id: "trace-1",
    workerId: "design-engineer",
    agentId: "design-engineer-agent",
    startedAt: "2026-08-01T10:00:00.000Z",
    status: "running" as const,
    toolCalls: [],
  };

  test("persists a trace and reads it back", async () => {
    const path = newPath();
    const store = new FileStore(path);
    const traces = new FileTraceStore(store);

    await traces.create(TRACE);

    expect((await traces.get("trace-1"))?.workerId).toBe("design-engineer");
    store.close();
  });

  // ── 16. Survives the process that wrote it ────────────────────

  test("reloads after a process restart", async () => {
    const path = newPath();

    // First "process".
    const first = new FileStore(path);
    const firstTraces = new FileTraceStore(first);
    await firstTraces.create(TRACE);
    await firstTraces.update("trace-1", {
      status: "completed",
      decisionType: "run_workflow",
      workflowId: "design-to-code",
      durationMs: 3_200,
      completedAt: "2026-08-01T10:00:03.200Z",
      executionId: "exec-1",
    });
    first.close();

    // Second "process": a new store sharing nothing but the file.
    const second = new FileTraceStore(new FileStore(path));
    const reloaded = await second.get("trace-1");

    expect(reloaded).toMatchObject({
      status: "completed",
      decisionType: "run_workflow",
      workflowId: "design-to-code",
      executionId: "exec-1",
    });
  });

  test("lists and filters across a restart", async () => {
    const path = newPath();
    const first = new FileStore(path);
    const traces = new FileTraceStore(first);

    await traces.create(TRACE);
    await traces.create({ ...TRACE, id: "trace-2", workerId: "other-worker" });
    await traces.update("trace-1", { executionId: "exec-1" });
    first.close();

    const reloaded = new FileTraceStore(new FileStore(path));

    expect(await reloaded.list()).toHaveLength(2);
    expect((await reloaded.list({ workerId: "other-worker" })).map((t) => t.id)).toEqual([
      "trace-2",
    ]);
    expect((await reloaded.list({ executionId: "exec-1" }))[0]?.id).toBe("trace-1");
  });

  test("an unknown trace reads as null, and updating one is silent", async () => {
    const traces = new FileTraceStore(new FileStore(newPath()));

    expect(await traces.get("nope")).toBeNull();
    await expect(traces.update("nope", { status: "completed" })).resolves.toBeUndefined();
  });

  test("refuses to store a trace carrying a payload", async () => {
    const traces = new FileTraceStore(new FileStore(newPath()));

    // The file is the audit record. It rejects rather than throws, so a caller
    // that wrapped this in `.catch()` actually catches it.
    await expect(
      traces.create({ ...TRACE, reasoning: "..." } as never),
    ).rejects.toThrow();
  });

  test("a hand-edited malformed trace is dropped, not surfaced", async () => {
    const path = newPath();
    const store = new FileStore(path);
    await new FileTraceStore(store).create(TRACE);

    // Someone opens runs.json in an editor and breaks an entry.
    store.mutate((document) => {
      document.traces["trace-broken"] = { id: "trace-broken" } as never;
    });

    const traces = new FileTraceStore(store);
    expect(await traces.get("trace-broken")).toBeNull();
    expect((await traces.list()).map((trace) => trace.id)).toEqual(["trace-1"]);
  });

  test("adding traces leaves the engine's own records untouched", async () => {
    const path = newPath();
    const store = new FileStore(path);

    await new FileTraceStore(store).create(TRACE);
    store.close();

    const document: unknown = JSON.parse(readFileSync(path, "utf8"));
    const record = document as Record<string, unknown>;

    // A sibling collection. Nothing in `executions`, `events` or `artifacts`
    // gained a field, so the engine's view of this file is what it always was.
    expect(record.traces).toBeDefined();
    expect(record.executions).toEqual({});
    expect(record.events).toEqual([]);
    expect(record.artifacts).toEqual({});
  });

  test("a document written before traces existed still loads", () => {
    const path = newPath();
    writeFileSync(
      path,
      JSON.stringify({ version: 1, executions: {}, events: [], artifacts: {} }),
    );

    const store = new FileStore(path);

    expect(store.data.traces).toEqual({});
  });
});

// ── Agent sessions ──────────────────────────────────────────────

describe("FileSessionStore", () => {
  const SESSION = {
    id: "session-1",
    workerId: "design-engineer",
    agentId: "design-engineer-agent",
    status: "active" as const,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    turnCount: 0,
    originalRequest: "make it nicer",
    answers: [],
    traceIds: [],
  };

  test("persists a session and reads it back", async () => {
    const path = newPath();
    const store = new FileStore(path);
    const sessions = new FileSessionStore(store);

    await sessions.create(SESSION);

    expect((await sessions.get("session-1"))?.workerId).toBe("design-engineer");
    store.close();
  });

  test("refuses to create a session under an id already in use", async () => {
    const sessions = new FileSessionStore(new FileStore(newPath()));
    await sessions.create(SESSION);

    await expectCode(sessions.create(SESSION), "ERR_SESSION_ALREADY_EXISTS");
  });

  test("updates under the expected version and bumps it", async () => {
    const sessions = new FileSessionStore(new FileStore(newPath()));
    await sessions.create(SESSION);

    const updated = await sessions.update("session-1", 1, {
      updatedAt: "2026-08-01T10:01:00.000Z",
      status: "waiting_for_user",
      currentQuestion: "Which component?",
    });

    expect(updated.version).toBe(2);
    expect(updated.status).toBe("waiting_for_user");
  });

  test("refuses an update against a stale version", async () => {
    const path = newPath();
    const sessions = new FileSessionStore(new FileStore(path));
    await sessions.create(SESSION);
    await sessions.update("session-1", 1, { updatedAt: "2026-08-01T10:01:00.000Z" });

    await expectCode(
      sessions.update("session-1", 1, { updatedAt: "2026-08-01T10:02:00.000Z" }),
      "ERR_SESSION_CONFLICT",
    );
  });

  test("refuses an update to an unknown session", async () => {
    const sessions = new FileSessionStore(new FileStore(newPath()));
    await expectCode(
      sessions.update("nope", 1, { updatedAt: "2026-08-01T10:01:00.000Z" }),
      "ERR_SESSION_NOT_FOUND",
    );
  });

  test("a stale-version update leaves the stored document untouched", async () => {
    const sessions = new FileSessionStore(new FileStore(newPath()));
    await sessions.create(SESSION);

    await expect(
      sessions.update("session-1", 999, { updatedAt: "2026-08-01T10:01:00.000Z" }),
    ).rejects.toThrow();

    expect((await sessions.get("session-1"))?.version).toBe(1);
  });

  test("reloads after a process restart", async () => {
    const path = newPath();

    const first = new FileStore(path);
    const firstSessions = new FileSessionStore(first);
    await firstSessions.create(SESSION);
    await firstSessions.update("session-1", 1, {
      updatedAt: "2026-08-01T10:01:00.000Z",
      status: "completed",
      executionId: "exec-1",
    });
    first.close();

    const second = new FileSessionStore(new FileStore(path));
    const reloaded = await second.get("session-1");

    expect(reloaded).toMatchObject({ status: "completed", executionId: "exec-1", version: 2 });
  });

  test("lists and filters across a restart", async () => {
    const path = newPath();
    const first = new FileStore(path);
    const sessions = new FileSessionStore(first);

    await sessions.create(SESSION);
    await sessions.create({ ...SESSION, id: "session-2", workerId: "other-worker" });
    first.close();

    const reloaded = new FileSessionStore(new FileStore(path));

    expect(await reloaded.list()).toHaveLength(2);
    expect(
      (await reloaded.list({ workerId: "other-worker" })).map((s) => s.id),
    ).toEqual(["session-2"]);
  });

  test("a hand-edited malformed session is dropped, not surfaced", async () => {
    const path = newPath();
    const store = new FileStore(path);
    await new FileSessionStore(store).create(SESSION);

    store.mutate((document) => {
      document.sessions["session-broken"] = { id: "session-broken" } as never;
    });

    const sessions = new FileSessionStore(store);
    expect(await sessions.get("session-broken")).toBeNull();
    expect((await sessions.list()).map((s) => s.id)).toEqual(["session-1"]);
  });

  test("adding sessions leaves the engine's own records untouched", async () => {
    const path = newPath();
    const store = new FileStore(path);

    await new FileSessionStore(store).create(SESSION);
    store.close();

    const document: unknown = JSON.parse(readFileSync(path, "utf8"));
    const record = document as Record<string, unknown>;

    expect(record.sessions).toBeDefined();
    expect(record.executions).toEqual({});
    expect(record.traces).toEqual({});
  });

  test("a document written before sessions existed still loads", () => {
    const path = newPath();
    writeFileSync(
      path,
      JSON.stringify({ version: 1, executions: {}, events: [], artifacts: {} }),
    );

    const store = new FileStore(path);

    expect(store.data.sessions).toEqual({});
  });
});
