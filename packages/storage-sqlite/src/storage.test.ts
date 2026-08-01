// packages/storage-sqlite/src/storage.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { DesignFlowError } from "@designflow/sdk";
import { openDatabase } from "./schema";
import { SqliteExecutionRepository } from "./execution-repository";
import { SqliteApprovalManager } from "./approval-manager";
import { SqliteExecutionEventStore } from "./event-store";
import { SqliteArtifactStore } from "./artifact-store";

/**
 * Storage adapter tests.
 *
 * Two things are being proven: that each adapter honours the contract it
 * implements, and that reopening the file recovers what was written. The
 * second is the whole reason this package exists.
 */

const workspaces: string[] = [];
const openDbs: Database[] = [];

function newPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-store-"));
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

// ── Execution repository ────────────────────────────────────────

describe("SqliteExecutionRepository", () => {
  test("round-trips an execution record", async () => {
    const repo = new SqliteExecutionRepository(open(newPath()));

    await repo.create({
      executionId: "exec-1",
      workflowId: "design-to-code",
      status: "running",
      startedAt: 1_000,
      metadata: { environment: "staging" },
    });

    const record = await repo.get("exec-1");

    expect(record?.status).toBe("running");
    expect(record?.metadata?.environment).toBe("staging");
  });

  test("merges a patch rather than replacing the record", async () => {
    const repo = new SqliteExecutionRepository(open(newPath()));

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
    expect(record?.completedAt).toBe(2_000);
    // Metadata carries the lineage and input a resume needs.
    expect(record?.metadata?.keep).toBe(true);
  });

  test("survives reopening the database", async () => {
    const path = newPath();

    const first = new SqliteExecutionRepository(open(path));
    await first.create({
      executionId: "exec-1",
      workflowId: "wf",
      status: "completed",
      startedAt: 1_000,
      completedAt: 2_000,
    });
    openDbs.pop()?.close();

    const second = new SqliteExecutionRepository(open(path));
    expect((await second.get("exec-1"))?.status).toBe("completed");
  });

  test("lists a workflow's runs newest first", async () => {
    const repo = new SqliteExecutionRepository(open(newPath()));

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

  test("keeps checkpoints in order and returns the latest", async () => {
    const repo = new SqliteExecutionRepository(open(newPath()));

    for (const phase of ["started", "executing", "completed"]) {
      await repo.saveCheckpoint("exec-1", {
        executionId: "exec-1",
        phase,
        timestamp: 1_000,
        state: { phase },
        metadata: { phase },
      });
    }

    expect((await repo.getLatestCheckpoint("exec-1"))?.phase).toBe("completed");
  });

  test("returns null for an unknown execution", async () => {
    const repo = new SqliteExecutionRepository(open(newPath()));

    expect(await repo.get("missing")).toBeNull();
    expect(await repo.getLatestCheckpoint("missing")).toBeNull();
  });
});

// ── Approvals ───────────────────────────────────────────────────

describe("SqliteApprovalManager", () => {
  test("creates a pending request and settles it", async () => {
    const approvals = new SqliteApprovalManager(open(newPath()));

    const request = await approvals.createRequest("exec-1", "wf", "writes files");
    expect(request.status).toBe("pending");

    const approved = await approvals.approve(request.id, "looks right");
    expect(approved.status).toBe("approved");
    expect(approved.metadata?.comment).toBe("looks right");
  });

  test("survives a restart so a person can answer later", async () => {
    const path = newPath();

    const first = new SqliteApprovalManager(open(path));
    const request = await first.createRequest("exec-1", "wf", "writes files");
    openDbs.pop()?.close();

    // The whole point of persisting approvals: the decision outlives the
    // process that asked for it.
    const second = new SqliteApprovalManager(open(path));
    const approved = await second.approve(request.id);

    expect(approved.status).toBe("approved");
  });

  test("refuses to re-decide a settled approval", async () => {
    const approvals = new SqliteApprovalManager(open(newPath()));
    const request = await approvals.createRequest("exec-1", "wf", "why");

    await approvals.reject(request.id);

    await expectCode(
      approvals.approve(request.id),
      "ERR_APPROVAL_STATE_TRANSITION",
    );
  });

  test("finds the approval blocking an execution", async () => {
    const approvals = new SqliteApprovalManager(open(newPath()));
    await approvals.createRequest("exec-1", "wf", "why");

    expect((await approvals.findPending("exec-1"))?.executionId).toBe("exec-1");
    expect(await approvals.findPending("exec-2")).toBeNull();
  });

  test("rejects an unknown approval", async () => {
    const approvals = new SqliteApprovalManager(open(newPath()));

    await expectCode(approvals.approve("missing"), "ERR_APPROVAL_NOT_FOUND");
  });

  test("an expired pending approval cannot authorize or refuse execution", async () => {
    const approvals = new SqliteApprovalManager(open(newPath()));
    const request = await approvals.createRequest("exec-1", "wf", "writes files", Date.now() - 1);

    await expectCode(approvals.approve(request.id), "ERR_APPROVAL_EXPIRED");
    await expectCode(approvals.reject(request.id), "ERR_APPROVAL_EXPIRED");
  });

  test("expireStale marks stale pending approvals and never touches a decided one, idempotently", async () => {
    const approvals = new SqliteApprovalManager(open(newPath()));

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

describe("SqliteExecutionEventStore", () => {
  test("records the raw stream in publish order", async () => {
    const store = new SqliteExecutionEventStore(open(newPath()));

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

    const events = await store.listEvents("exec-1");

    // artifact.* events are exactly what the engine's own subscriber drops.
    expect(events.map((event) => event.type)).toEqual([
      "execution.started",
      "artifact.created",
      "execution.completed",
    ]);
  });

  test("keeps executions apart", async () => {
    const store = new SqliteExecutionEventStore(open(newPath()));

    store.append({
      id: "a",
      executionId: "exec-1",
      type: "execution.started",
      timestamp: 1,
    });
    store.append({
      id: "b",
      executionId: "exec-2",
      type: "execution.started",
      timestamp: 2,
    });

    expect(await store.listEvents("exec-1")).toHaveLength(1);
  });

  test("survives a restart", async () => {
    const path = newPath();

    const first = new SqliteExecutionEventStore(open(path));
    first.append({
      id: "a",
      executionId: "exec-1",
      type: "execution.completed",
      timestamp: 1,
      payload: { artifactCount: 5 },
    });
    openDbs.pop()?.close();

    const second = new SqliteExecutionEventStore(open(path));
    const events = await second.listEvents("exec-1");

    expect(events[0]?.payload?.artifactCount).toBe(5);
  });
});

// ── Artifact store ──────────────────────────────────────────────

describe("SqliteArtifactStore", () => {
  test("registers an artifact with version 1 and provenance", async () => {
    const store = new SqliteArtifactStore(open(newPath()));

    const artifact = await store.createArtifact({
      id: "ui-ir",
      type: "ui.ir",
      metadata: { name: "UI IR" },
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
    const store = new SqliteArtifactStore(open(newPath()));
    await store.createArtifact({ id: "a", type: "t", metadata: { n: 1 } });

    await store.createVersion("a", { n: 2 });

    expect((await store.getArtifact("a"))?.version).toBe(2);
    // Existing version records are never rewritten.
    expect((await store.getVersion("a", 1))?.metadata).toEqual({ n: 1 });
  });

  test("rejects a duplicate registration", async () => {
    const store = new SqliteArtifactStore(open(newPath()));
    await store.createArtifact({ id: "a", type: "t", metadata: {} });

    await expectCode(
      store.createArtifact({ id: "a", type: "t", metadata: {} }),
      "ERR_ARTIFACT_EXISTS",
    );
  });

  test("content-addresses payloads and resolves a repeat save", async () => {
    const store = new SqliteArtifactStore(open(newPath()));

    const first = await store.save({ a: 1, b: 2 });
    const second = await store.save({ b: 2, a: 1 });

    expect(second.id).toBe(first.id);
    expect((await store.get(first.id))?.data).toEqual({ a: 1, b: 2 });
    expect(await store.exists(first.id)).toBe(true);
  });

  test("walks lineage in both directions", async () => {
    const store = new SqliteArtifactStore(open(newPath()));

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
    const store = new SqliteArtifactStore(open(newPath()));

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
    const store = new SqliteArtifactStore(open(newPath()));

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
    const store = new SqliteArtifactStore(open(newPath()));
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

    const store = new SqliteArtifactStore(open(newPath()), {
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
    // artifacts, however many rows are on disk.
    expect(published).toEqual(["artifact.created", "artifact.version_created"]);
  });

  test("stays silent for an artifact registered outside an execution", async () => {
    const published: string[] = [];

    const store = new SqliteArtifactStore(open(newPath()), {
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

    const first = new SqliteArtifactStore(open(path));
    await first.createArtifact({ id: "figma", type: "t", metadata: {} });
    await first.createArtifact({ id: "ui-ir", type: "t", metadata: {} });
    await first.addRelation({
      sourceArtifactId: "ui-ir",
      targetArtifactId: "figma",
      relation: "derived_from",
    });
    openDbs.pop()?.close();

    const second = new SqliteArtifactStore(open(path));

    expect((await second.getLineage("ui-ir")).ancestors).toEqual(["figma"]);
  });
});
