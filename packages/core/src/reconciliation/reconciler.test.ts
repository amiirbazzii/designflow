// packages/core/src/reconciliation/reconciler.test.ts
import { describe, expect, test } from "bun:test";
import {
  type ArtifactRef,
  DesignFlowError,
} from "@designflow/sdk";

import { ArtifactSetReconciler } from "./reconciler";
import { findSetConflicts, identityOf } from "./comparison";
import { InMemoryArtifactStore } from "../artifacts";

// ── Helpers ─────────────────────────────────────────────────────

interface Fixture {
  readonly store: InMemoryArtifactStore;
  readonly reconciler: ArtifactSetReconciler;
}

const createFixture = (): Fixture => {
  const store = new InMemoryArtifactStore();
  return { store, reconciler: new ArtifactSetReconciler({ registry: store }) };
};

/** Registers `id` and advances it to `version`, returning a reference. */
const register = async (
  store: InMemoryArtifactStore,
  id: string,
  version = 1,
  metadata: Record<string, unknown> = {},
): Promise<ArtifactRef> => {
  const existing = await store.getArtifact(id);

  if (existing === null) {
    await store.createArtifact({ id, type: "test", metadata });
  }

  let current = await store.getArtifact(id);
  while (current !== null && current.version < version) {
    await store.createVersion(id, metadata);
    current = await store.getArtifact(id);
  }

  return { id, type: "test", metadata };
};

const expectCode = async (
  operation: Promise<unknown>,
  code: string,
): Promise<DesignFlowError> => {
  try {
    await operation;
    throw new Error(`Expected rejection with ${code}`);
  } catch (error) {
    if (!(error instanceof DesignFlowError)) {
      throw new Error(`Expected a DesignFlowError, received ${String(error)}`, { cause: error });
    }
    expect(error.code).toBe(code);
    return error;
  }
};

// ── 1. Merge reused and produced ────────────────────────────────

describe("reconcile", () => {
  test("merges reused and produced into the final set", async () => {
    const { store, reconciler } = createFixture();

    // Previous run: ui-ir:v1, code:v1. This run reuses ui-ir and rebuilds code.
    const uiIr = await register(store, "ui-ir", 1);
    const codeV1: ArtifactRef = { id: "code", type: "test", metadata: {}, version: 1 };
    const code = await register(store, "code", 2);

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [uiIr, codeV1],
      reusedArtifacts: [uiIr],
      producedArtifacts: [code],
    });

    expect(result.executionId).toBe("exec-2");
    expect(result.artifacts.map((a) => a.id)).toEqual(["ui-ir", "code"]);
    expect(result.reusedArtifactIds).toEqual(["ui-ir"]);
    expect(result.producedArtifactIds).toEqual(["code"]);
    expect(result.removedArtifactIds).toEqual([]);
  });

  test("handles a run with nothing reused", async () => {
    const { store, reconciler } = createFixture();
    const code = await register(store, "code");

    const result = await reconciler.reconcile({
      executionId: "exec-1",
      previousArtifacts: [],
      reusedArtifacts: [],
      producedArtifacts: [code],
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.reusedArtifactIds).toEqual([]);
  });

  test("drops references the registry does not know", async () => {
    const { store, reconciler } = createFixture();
    const known = await register(store, "ui-ir");

    const result = await reconciler.reconcile({
      executionId: "exec-1",
      previousArtifacts: [],
      reusedArtifacts: [],
      producedArtifacts: [known, { id: "ghost", type: "test", metadata: {} }],
    });

    // An artifact with no registry record has no identity to reconcile.
    expect(result.artifacts.map((a) => a.id)).toEqual(["ui-ir"]);
  });

  test("rejects a missing executionId", async () => {
    const { reconciler } = createFixture();

    await expect(
      reconciler.reconcile({
        executionId: "",
        previousArtifacts: [],
        reusedArtifacts: [],
        producedArtifacts: [],
      }),
    ).rejects.toThrow();
  });
});

// ── 2. Preserve unchanged artifacts ─────────────────────────────

describe("preservation", () => {
  test("keeps a reused artifact in the final set", async () => {
    const { store, reconciler } = createFixture();
    const uiIr = await register(store, "ui-ir");

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [uiIr],
      reusedArtifacts: [uiIr],
      producedArtifacts: [],
    });

    expect(result.artifacts.map((a) => a.id)).toEqual(["ui-ir"]);
    expect(result.removedArtifactIds).toEqual([]);
  });

  test("preserves the reference's lineage", async () => {
    const { store, reconciler } = createFixture();
    await register(store, "ui-ir");

    const withLineage: ArtifactRef = {
      id: "ui-ir",
      type: "test",
      metadata: {},
      lineage: {
        executionId: "exec-1",
        workflowId: "wf",
        capabilityId: "cap-transform",
        parents: ["figma-json"],
      },
    };

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [],
      reusedArtifacts: [withLineage],
      producedArtifacts: [],
    });

    expect(result.artifacts[0]?.lineage?.parents).toEqual(["figma-json"]);
    expect(result.artifacts[0]?.lineage?.capabilityId).toBe("cap-transform");
  });
});

// ── 3. Detect removed artifacts ─────────────────────────────────

describe("removal detection", () => {
  test("reports a previous artifact that is neither reused nor produced", async () => {
    const { store, reconciler } = createFixture();
    const uiIr = await register(store, "ui-ir");
    const dropped = await register(store, "legacy-css");

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [uiIr, dropped],
      reusedArtifacts: [uiIr],
      producedArtifacts: [],
    });

    expect(result.removedArtifactIds).toEqual(["legacy-css"]);
  });

  test("does not report an id that survived at a new version", async () => {
    const { store, reconciler } = createFixture();
    const codeV1: ArtifactRef = { id: "code", type: "test", metadata: {}, version: 1 };
    const codeV2 = await register(store, "code", 2);

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [codeV1],
      reusedArtifacts: [],
      producedArtifacts: [codeV2],
    });

    // Removal is keyed on id: the artifact advanced, it did not leave.
    expect(result.removedArtifactIds).toEqual([]);
  });

  test("reports every dropped id once", async () => {
    const { store, reconciler } = createFixture();
    const a = await register(store, "a");
    const b = await register(store, "b");
    const kept = await register(store, "kept");

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [a, b, a, kept],
      reusedArtifacts: [kept],
      producedArtifacts: [],
    });

    expect(result.removedArtifactIds.sort()).toEqual(["a", "b"]);
  });
});

// ── 4. Detect duplicate identity ────────────────────────────────

describe("duplicate identity", () => {
  test("rejects the same id and version twice in the merged set", async () => {
    const { store, reconciler } = createFixture();
    const uiIr = await register(store, "ui-ir");

    const error = await expectCode(
      reconciler.reconcile({
        executionId: "exec-1",
        previousArtifacts: [],
        reusedArtifacts: [uiIr],
        producedArtifacts: [uiIr],
      }),
      "ERR_ARTIFACT_RECONCILIATION_FAILED",
    );

    expect(JSON.stringify(error.metadata)).toContain("duplicate_identity");
    expect(error.metadata.executionId).toBe("exec-1");
  });

  test("rejects a duplicate within one input list", async () => {
    const { store, reconciler } = createFixture();
    const uiIr = await register(store, "ui-ir");

    await expectCode(
      reconciler.reconcile({
        executionId: "exec-1",
        previousArtifacts: [],
        reusedArtifacts: [],
        producedArtifacts: [uiIr, uiIr],
      }),
      "ERR_ARTIFACT_RECONCILIATION_FAILED",
    );
  });

  test("keys identity on id and version together", () => {
    expect(
      identityOf({ ref: { id: "a", type: "t", metadata: {} }, version: 1 }),
    ).not.toBe(
      identityOf({ ref: { id: "a", type: "t", metadata: {} }, version: 2 }),
    );
  });

  test("accepts distinct artifacts", () => {
    expect(
      findSetConflicts([
        { ref: { id: "a", type: "t", metadata: {} }, version: 1 },
        { ref: { id: "b", type: "t", metadata: {} }, version: 1 },
      ]),
    ).toEqual([]);
  });
});

// ── 5. Detect conflicting artifact versions ─────────────────────

describe("version conflicts", () => {
  test("rejects a produced artifact reusing a prior identity with new content", async () => {
    const { store, reconciler } = createFixture();
    await register(store, "code", 1);

    const previous: ArtifactRef = {
      id: "code",
      type: "test",
      metadata: { lines: 100 },
    };
    const produced: ArtifactRef = {
      id: "code",
      type: "test",
      metadata: { lines: 250 },
    };

    const error = await expectCode(
      reconciler.reconcile({
        executionId: "exec-2",
        previousArtifacts: [previous],
        reusedArtifacts: [],
        producedArtifacts: [produced],
      }),
      "ERR_ARTIFACT_RECONCILIATION_FAILED",
    );

    expect(JSON.stringify(error.metadata)).toContain("content_conflict");
  });

  test("accepts a produced artifact identical to the previous one", async () => {
    const { store, reconciler } = createFixture();
    await register(store, "code", 1);

    const same: ArtifactRef = {
      id: "code",
      type: "test",
      metadata: { lines: 100 },
    };

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [same],
      reusedArtifacts: [],
      producedArtifacts: [{ ...same, metadata: { lines: 100 } }],
    });

    // Re-running a node and getting the same answer is not a conflict.
    expect(result.artifacts).toHaveLength(1);
  });

  test("compares content canonically", async () => {
    const { store, reconciler } = createFixture();
    await register(store, "code", 1);

    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: [
        { id: "code", type: "test", metadata: { a: 1, b: 2 } },
      ],
      reusedArtifacts: [],
      producedArtifacts: [
        { id: "code", type: "test", metadata: { b: 2, a: 1 } },
      ],
    });

    expect(result.artifacts).toHaveLength(1);
  });

  test("rejects one id present at two versions", () => {
    const conflicts = findSetConflicts([
      { ref: { id: "code", type: "t", metadata: {} }, version: 1 },
      { ref: { id: "code", type: "t", metadata: {} }, version: 2 },
    ]);

    // A dependent could not tell which revision it is meant to consume.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe("ambiguous_version");
  });
});

// ── 6. Generate reconciliation report ───────────────────────────

describe("createReport", () => {
  test("counts the worked example", async () => {
    const { store, reconciler } = createFixture();

    const uiIr = await register(store, "ui-ir", 1);
    const codeV1: ArtifactRef = { id: "code", type: "test", metadata: {}, version: 1 };
    const codeV2 = await register(store, "code", 2);

    const previous = [uiIr, codeV1];
    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: previous,
      reusedArtifacts: [uiIr],
      producedArtifacts: [codeV2],
    });

    const report = await reconciler.createReport(previous, result);

    expect(report).toEqual({
      executionId: "exec-2",
      added: 1,
      reused: 1,
      removed: 0,
      unchanged: 0,
    });
  });

  test("counts an unchanged artifact that was recomputed", async () => {
    const { store, reconciler } = createFixture();
    const code = await register(store, "code", 1);

    const previous = [code];
    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: previous,
      reusedArtifacts: [],
      producedArtifacts: [code],
    });

    const report = await reconciler.createReport(previous, result);

    // Ran again, produced the same identity: unchanged, not added.
    expect(report.unchanged).toBe(1);
    expect(report.added).toBe(0);
    expect(report.reused).toBe(0);
  });

  test("counts removals", async () => {
    const { store, reconciler } = createFixture();
    const kept = await register(store, "kept");
    const dropped = await register(store, "dropped");

    const previous = [kept, dropped];
    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: previous,
      reusedArtifacts: [kept],
      producedArtifacts: [],
    });

    const report = await reconciler.createReport(previous, result);

    expect(report.removed).toBe(1);
    expect(report.reused).toBe(1);
  });

  test("counts a first run as all added", async () => {
    const { store, reconciler } = createFixture();
    const a = await register(store, "a");
    const b = await register(store, "b");

    const result = await reconciler.reconcile({
      executionId: "exec-1",
      previousArtifacts: [],
      reusedArtifacts: [],
      producedArtifacts: [a, b],
    });

    const report = await reconciler.createReport([], result);

    expect(report).toEqual({
      executionId: "exec-1",
      added: 2,
      reused: 0,
      removed: 0,
      unchanged: 0,
    });
  });

  test("counts a reused artifact the previous run did not hold as reused", async () => {
    const { store, reconciler } = createFixture();
    const older = await register(store, "older");

    const result = await reconciler.reconcile({
      executionId: "exec-3",
      previousArtifacts: [],
      reusedArtifacts: [older],
      producedArtifacts: [],
    });

    const report = await reconciler.createReport([], result);

    // `reused` describes how it arrived, not whether the previous set held it.
    expect(report.reused).toBe(1);
    expect(report.added).toBe(0);
  });

  test("partitions the final set across added, reused and unchanged", async () => {
    const { store, reconciler } = createFixture();

    const reusedRef = await register(store, "reused-one");
    const unchangedRef = await register(store, "unchanged-one");
    const addedRef = await register(store, "added-one");

    const previous = [reusedRef, unchangedRef];
    const result = await reconciler.reconcile({
      executionId: "exec-2",
      previousArtifacts: previous,
      reusedArtifacts: [reusedRef],
      producedArtifacts: [unchangedRef, addedRef],
    });

    const report = await reconciler.createReport(previous, result);

    expect(report.added + report.reused + report.unchanged).toBe(
      result.artifacts.length,
    );
    expect(report.reused).toBe(1);
    expect(report.unchanged).toBe(1);
    expect(report.added).toBe(1);
  });
});
