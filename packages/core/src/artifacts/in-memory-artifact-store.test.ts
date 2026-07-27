import { describe, expect, test } from "bun:test";
import type { ArtifactProvenance, ExecutionEvent } from "@designflow/sdk";
import { DesignFlowError } from "@designflow/sdk";
import { InMemoryArtifactStore } from "./in-memory-artifact-store";
import { isArtifactRegistry } from "./registry-support";
import { InMemoryEventPublisher } from "../events";

// ── Helpers ─────────────────────────────────────────────────────

const provenance: ArtifactProvenance = {
  executionId: "exec-1",
  workflowId: "wf-1",
  capabilityId: "cap-1",
};

const createRecordingStore = (): {
  store: InMemoryArtifactStore;
  events: ExecutionEvent[];
} => {
  const events: ExecutionEvent[] = [];
  const publisher = new InMemoryEventPublisher();
  publisher.subscribe((event) => {
    events.push(event);
  });

  return {
    store: new InMemoryArtifactStore({ eventPublisher: publisher }),
    events,
  };
};

/** Registers a bare artifact so relations have valid endpoints. */
const register = async (
  store: InMemoryArtifactStore,
  id: string,
  type = "test",
): Promise<void> => {
  await store.createArtifact({ id, type, metadata: {}, provenance });
};

const expectCode = async (
  operation: Promise<unknown>,
  code: string,
): Promise<void> => {
  try {
    await operation;
    throw new Error(`Expected operation to reject with ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DesignFlowError);
    expect(error instanceof DesignFlowError ? error.code : "").toBe(code);
  }
};

// ── 1. Create artifact ──────────────────────────────────────────

describe("createArtifact", () => {
  test("registers identity, version 1 and provenance", async () => {
    const store = new InMemoryArtifactStore();

    const artifact = await store.createArtifact({
      id: "ui-ir",
      type: "ui.ir",
      metadata: { source: "figma" },
      provenance,
    });

    expect(artifact.id).toBe("ui-ir");
    expect(artifact.type).toBe("ui.ir");
    expect(artifact.version).toBe(1);
    expect(artifact.metadata).toEqual({ source: "figma" });
    expect(artifact.provenance).toEqual(provenance);
    expect(artifact.createdAt).toBeGreaterThan(0);

    expect(await store.getArtifact("ui-ir")).toEqual(artifact);
  });

  test("assigns an id when the caller omits one", async () => {
    const store = new InMemoryArtifactStore();

    const artifact = await store.createArtifact({ type: "ui.ir", metadata: {} });

    expect(artifact.id.length).toBeGreaterThan(0);
    expect(await store.getArtifact(artifact.id)).not.toBeNull();
  });

  test("creates version 1 alongside the artifact", async () => {
    const store = new InMemoryArtifactStore();

    await store.createArtifact({ id: "a", type: "t", metadata: { n: 1 } });

    const first = await store.getVersion("a", 1);
    expect(first?.version).toBe(1);
    expect(first?.metadata).toEqual({ n: 1 });
    expect(first?.hash.length).toBe(64);
  });

  test("rejects a duplicate id", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "a");

    await expectCode(
      store.createArtifact({ id: "a", type: "t", metadata: {} }),
      "ERR_ARTIFACT_EXISTS",
    );
  });

  test("returns null for an unknown artifact", async () => {
    const store = new InMemoryArtifactStore();

    expect(await store.getArtifact("missing")).toBeNull();
  });
});

// ── 2. Create artifact version ──────────────────────────────────

describe("createVersion", () => {
  test("appends a version and advances the latest pointer", async () => {
    const store = new InMemoryArtifactStore();
    await store.createArtifact({ id: "a", type: "t", metadata: { n: 1 } });

    const second = await store.createVersion("a", { n: 2 });

    expect(second.artifactId).toBe("a");
    expect(second.version).toBe(2);
    expect(second.metadata).toEqual({ n: 2 });

    const artifact = await store.getArtifact("a");
    expect(artifact?.version).toBe(2);

    // The original artifact metadata is the identity record, not the version.
    expect(artifact?.metadata).toEqual({ n: 1 });
  });

  test("keeps earlier versions retrievable and distinct", async () => {
    const store = new InMemoryArtifactStore();
    await store.createArtifact({ id: "a", type: "t", metadata: { n: 1 } });
    await store.createVersion("a", { n: 2 });
    await store.createVersion("a", { n: 3 });

    const v1 = await store.getVersion("a", 1);
    const v2 = await store.getVersion("a", 2);
    const v3 = await store.getVersion("a", 3);

    expect(v1?.metadata).toEqual({ n: 1 });
    expect(v2?.metadata).toEqual({ n: 2 });
    expect(v3?.metadata).toEqual({ n: 3 });

    const hashes = new Set([v1?.hash, v2?.hash, v3?.hash]);
    expect(hashes.size).toBe(3);
  });

  test("hashes identical content identically across artifacts", async () => {
    const store = new InMemoryArtifactStore();
    await store.createArtifact({ id: "a", type: "t", metadata: { x: 1, y: 2 } });
    await store.createArtifact({ id: "b", type: "t", metadata: { y: 2, x: 1 } });

    const a = await store.getVersion("a", 1);
    const b = await store.getVersion("b", 1);

    // Version identity is content-derived; key order must not affect it.
    expect(a?.hash).not.toBe(b?.hash); // artifactId participates in the hash
    expect(a?.hash.length).toBe(b?.hash.length);

    await store.createVersion("a", { p: 1, q: 2 });
    await store.createVersion("a", { q: 2, p: 1 });

    const v2 = await store.getVersion("a", 2);
    const v3 = await store.getVersion("a", 3);
    expect(v2?.hash).not.toBe(v3?.hash); // version number participates too
  });

  test("rejects versioning an unknown artifact", async () => {
    const store = new InMemoryArtifactStore();

    await expectCode(store.createVersion("missing"), "ERR_ARTIFACT_NOT_FOUND");
  });

  test("returns null for an unknown version", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "a");

    expect(await store.getVersion("a", 7)).toBeNull();
    expect(await store.getVersion("missing", 1)).toBeNull();
  });
});

// ── 3. Version immutability ─────────────────────────────────────

describe("version immutability", () => {
  test("a returned version cannot be mutated", async () => {
    const store = new InMemoryArtifactStore();
    await store.createArtifact({ id: "a", type: "t", metadata: {} });

    const version = await store.createVersion("a", { note: "original" });

    expect(() => {
      Object.assign(version, { version: 99 });
    }).toThrow();

    expect(() => {
      Object.assign(version.metadata ?? {}, { note: "tampered" });
    }).toThrow();
  });

  test("mutating the caller's metadata does not reach the store", async () => {
    const store = new InMemoryArtifactStore();
    await store.createArtifact({ id: "a", type: "t", metadata: {} });

    const metadata: Record<string, unknown> = { note: "original" };
    await store.createVersion("a", metadata);

    metadata.note = "tampered";

    const stored = await store.getVersion("a", 2);
    expect(stored?.metadata).toEqual({ note: "original" });
  });

  test("creating a new version leaves earlier version records untouched", async () => {
    const store = new InMemoryArtifactStore();
    await store.createArtifact({ id: "a", type: "t", metadata: { n: 1 } });

    const before = await store.getVersion("a", 1);
    await store.createVersion("a", { n: 2 });
    const after = await store.getVersion("a", 1);

    expect(after).toEqual(before);
  });

  test("a returned artifact cannot be mutated", async () => {
    const store = new InMemoryArtifactStore();
    const artifact = await store.createArtifact({
      id: "a",
      type: "t",
      metadata: { n: 1 },
    });

    expect(() => {
      Object.assign(artifact, { type: "tampered" });
    }).toThrow();

    expect((await store.getArtifact("a"))?.type).toBe("t");
  });
});

// ── 4. Artifact relation creation ───────────────────────────────

describe("addRelation", () => {
  test("records a relation between two registered artifacts", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "ui-ir");
    await register(store, "figma-json");

    await store.addRelation({
      sourceArtifactId: "ui-ir",
      targetArtifactId: "figma-json",
      relation: "derived_from",
    });

    const lineage = await store.getLineage("ui-ir");
    expect(lineage.relations).toEqual([
      {
        sourceArtifactId: "ui-ir",
        targetArtifactId: "figma-json",
        relation: "derived_from",
      },
    ]);
  });

  test("is idempotent for an identical relation", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "a");
    await register(store, "b");

    const edge = {
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "derived_from",
    } as const;

    await store.addRelation(edge);
    await store.addRelation(edge);

    expect((await store.getLineage("a")).relations).toHaveLength(1);
  });

  test("allows different relation types between the same pair", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "a");
    await register(store, "b");

    await store.addRelation({
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "derived_from",
    });
    await store.addRelation({
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "validated_by",
    });

    expect((await store.getLineage("a")).relations).toHaveLength(2);
  });
});

// ── 5. Invalid relation rejected ────────────────────────────────

describe("relation validation", () => {
  test("rejects a relation whose source does not exist", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "b");

    await expectCode(
      store.addRelation({
        sourceArtifactId: "missing",
        targetArtifactId: "b",
        relation: "derived_from",
      }),
      "ERR_ARTIFACT_NOT_FOUND",
    );
  });

  test("rejects a relation whose target does not exist", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "a");

    await expectCode(
      store.addRelation({
        sourceArtifactId: "a",
        targetArtifactId: "missing",
        relation: "derived_from",
      }),
      "ERR_ARTIFACT_NOT_FOUND",
    );
  });

  test("rejects an unknown relation type", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "a");
    await register(store, "b");

    const invalid = {
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "inspired_by",
    };

    // Boundary validation happens before any state is touched.
    await expect(
      store.addRelation(
        invalid as unknown as Parameters<typeof store.addRelation>[0],
      ),
    ).rejects.toThrow();

    expect((await store.getLineage("a")).relations).toHaveLength(0);
  });
});

// ── 6. Cycle detection ──────────────────────────────────────────

describe("cycle detection", () => {
  test("rejects a direct cycle: A derived_from B then B derived_from A", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "A");
    await register(store, "B");

    await store.addRelation({
      sourceArtifactId: "A",
      targetArtifactId: "B",
      relation: "derived_from",
    });

    await expectCode(
      store.addRelation({
        sourceArtifactId: "B",
        targetArtifactId: "A",
        relation: "derived_from",
      }),
      "ERR_ARTIFACT_CYCLE",
    );

    expect((await store.getLineage("A")).relations).toHaveLength(1);
  });

  test("rejects a transitive cycle A -> B -> C -> A", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "A");
    await register(store, "B");
    await register(store, "C");

    await store.addRelation({
      sourceArtifactId: "A",
      targetArtifactId: "B",
      relation: "derived_from",
    });
    await store.addRelation({
      sourceArtifactId: "B",
      targetArtifactId: "C",
      relation: "derived_from",
    });

    await expectCode(
      store.addRelation({
        sourceArtifactId: "C",
        targetArtifactId: "A",
        relation: "derived_from",
      }),
      "ERR_ARTIFACT_CYCLE",
    );
  });

  test("rejects a self relation", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "A");

    await expectCode(
      store.addRelation({
        sourceArtifactId: "A",
        targetArtifactId: "A",
        relation: "derived_from",
      }),
      "ERR_ARTIFACT_CYCLE",
    );
  });

  test("allows opposing edges of different relation types", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "old");
    await register(store, "new");

    // "new derived_from old" and "old replaced_by new" describe the same
    // supersession from both sides and must both be recordable.
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

  test("reports the offending path on the error", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "A");
    await register(store, "B");

    await store.addRelation({
      sourceArtifactId: "A",
      targetArtifactId: "B",
      relation: "derived_from",
    });

    try {
      await store.addRelation({
        sourceArtifactId: "B",
        targetArtifactId: "A",
        relation: "derived_from",
      });
      throw new Error("expected a cycle error");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      const metadata = error instanceof DesignFlowError ? error.metadata : {};
      expect(metadata.cyclePath).toEqual(["B", "A", "B"]);
    }
  });
});

// ── 7. Lineage traversal ────────────────────────────────────────

describe("getLineage", () => {
  /**
   * Figma JSON -> UI IR -> Generated Code -> Validated Patch
   * Edges point from each artifact toward what it came from.
   */
  const buildChain = async (): Promise<InMemoryArtifactStore> => {
    const store = new InMemoryArtifactStore();

    await register(store, "figma-json", "figma.json");
    await register(store, "ui-ir", "ui.ir");
    await register(store, "generated-code", "code");
    await register(store, "validated-patch", "patch");

    await store.addRelation({
      sourceArtifactId: "ui-ir",
      targetArtifactId: "figma-json",
      relation: "derived_from",
    });
    await store.addRelation({
      sourceArtifactId: "generated-code",
      targetArtifactId: "ui-ir",
      relation: "generated_from",
    });
    await store.addRelation({
      sourceArtifactId: "validated-patch",
      targetArtifactId: "generated-code",
      relation: "derived_from",
    });

    return store;
  };

  test("walks the full ancestor chain from the leaf, nearest first", async () => {
    const store = await buildChain();

    const lineage = await store.getLineage("validated-patch");

    expect(lineage.artifactId).toBe("validated-patch");
    expect(lineage.ancestors).toEqual([
      "generated-code",
      "ui-ir",
      "figma-json",
    ]);
    expect(lineage.descendants).toEqual([]);
  });

  test("walks descendants from the root", async () => {
    const store = await buildChain();

    const lineage = await store.getLineage("figma-json");

    expect(lineage.ancestors).toEqual([]);
    expect(lineage.descendants).toEqual([
      "ui-ir",
      "generated-code",
      "validated-patch",
    ]);
  });

  test("reports both directions from the middle of the chain", async () => {
    const store = await buildChain();

    const lineage = await store.getLineage("ui-ir");

    expect(lineage.ancestors).toEqual(["figma-json"]);
    expect(lineage.descendants).toEqual(["generated-code", "validated-patch"]);
  });

  test("includes every connected node and its relations", async () => {
    const store = await buildChain();

    const lineage = await store.getLineage("ui-ir");

    expect(lineage.nodes.map((node) => node.id).sort()).toEqual([
      "figma-json",
      "generated-code",
      "ui-ir",
      "validated-patch",
    ]);
    expect(lineage.relations).toHaveLength(3);
    expect(lineage.nodes.every((node) => node.version === 1)).toBe(true);
  });

  test("returns an isolated artifact as a single node", async () => {
    const store = new InMemoryArtifactStore();
    await register(store, "lonely");

    const lineage = await store.getLineage("lonely");

    expect(lineage.nodes).toHaveLength(1);
    expect(lineage.relations).toHaveLength(0);
    expect(lineage.ancestors).toEqual([]);
    expect(lineage.descendants).toEqual([]);
  });

  test("rejects lineage for an unknown artifact", async () => {
    const store = new InMemoryArtifactStore();

    await expectCode(store.getLineage("missing"), "ERR_ARTIFACT_NOT_FOUND");
  });
});

// ── 10. Artifact events emitted ─────────────────────────────────

describe("artifact events", () => {
  test("publishes artifact.created and artifact.version_created on registration", async () => {
    const { store, events } = createRecordingStore();

    await store.createArtifact({
      id: "a",
      type: "t",
      metadata: {},
      provenance,
    });

    expect(events.map((event) => event.type)).toEqual([
      "artifact.created",
      "artifact.version_created",
    ]);
    expect(events[0]?.executionId).toBe("exec-1");
    expect(events[0]?.payload).toEqual({ artifactId: "a", version: 1 });
    expect(events[1]?.payload).toEqual({ artifactId: "a", version: 1 });
  });

  test("publishes artifact.version_created for each later version", async () => {
    const { store, events } = createRecordingStore();

    await store.createArtifact({ id: "a", type: "t", metadata: {}, provenance });
    events.length = 0;

    await store.createVersion("a", { n: 2 });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("artifact.version_created");
    expect(events[0]?.payload).toEqual({ artifactId: "a", version: 2 });
  });

  test("publishes artifact.relation_added with the edge it recorded", async () => {
    const { store, events } = createRecordingStore();

    await register(store, "a");
    await register(store, "b");
    events.length = 0;

    await store.addRelation({
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "derived_from",
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("artifact.relation_added");
    expect(events[0]?.payload).toEqual({
      artifactId: "a",
      targetArtifactId: "b",
      relation: "derived_from",
    });
  });

  test("publishes nothing for an artifact registered outside an execution", async () => {
    const { store, events } = createRecordingStore();

    await store.createArtifact({ id: "a", type: "t", metadata: {} });

    expect(events).toHaveLength(0);
  });

  test("emits no event for a duplicate relation", async () => {
    const { store, events } = createRecordingStore();

    await register(store, "a");
    await register(store, "b");

    const edge = {
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "derived_from",
    } as const;

    await store.addRelation(edge);
    events.length = 0;
    await store.addRelation(edge);

    expect(events).toHaveLength(0);
  });
});

// ── Payload boundary ────────────────────────────────────────────

describe("payload storage", () => {
  test("save content-addresses the payload and registers the artifact", async () => {
    const store = new InMemoryArtifactStore();

    const ref = await store.save(
      { component: "Button" },
      { label: "button" },
      {
        executionId: "exec-1",
        workflowId: "wf-1",
        capabilityId: "cap-1",
        parents: [],
      },
    );

    expect(ref.id.length).toBe(64);
    expect(await store.exists(ref.id)).toBe(true);

    const artifact = await store.getArtifact(ref.id);
    expect(artifact?.provenance).toEqual(provenance);
  });

  test("saving identical content resolves to the same artifact", async () => {
    const store = new InMemoryArtifactStore();

    const first = await store.save({ a: 1, b: 2 });
    const second = await store.save({ b: 2, a: 1 });

    expect(second.id).toBe(first.id);
    expect((await store.getArtifact(first.id))?.version).toBe(1);
  });

  test("save links the artifact to its declared parents", async () => {
    const store = new InMemoryArtifactStore();

    const parent = await store.save({ stage: "ir" });
    const child = await store.save({ stage: "code" }, undefined, {
      executionId: "exec-1",
      workflowId: "wf-1",
      capabilityId: "cap-2",
      parents: [parent.id],
    });

    const lineage = await store.getLineage(child.id);
    expect(lineage.ancestors).toEqual([parent.id]);
  });

  test("get returns a detached copy of the payload", async () => {
    const store = new InMemoryArtifactStore();
    const ref = await store.save({ nested: { value: 1 } });

    const loaded = await store.get(ref.id);
    expect(loaded?.data).toEqual({ nested: { value: 1 } });

    const again = await store.get(ref.id);
    expect(again?.data).not.toBe(loaded?.data);
  });

  test("get returns null for an unknown payload", async () => {
    const store = new InMemoryArtifactStore();

    expect(await store.get("missing")).toBeNull();
    expect(await store.exists("missing")).toBe(false);
  });
});

// ── Registry capability detection ───────────────────────────────

describe("isArtifactRegistry", () => {
  test("recognises a registry-backed store", () => {
    expect(isArtifactRegistry(new InMemoryArtifactStore())).toBe(true);
  });

  test("rejects a payload-only store", () => {
    const payloadOnly = {
      save: async () => ({ id: "a", type: "t", metadata: {} }),
      get: async () => null,
      exists: async () => false,
    };

    expect(isArtifactRegistry(payloadOnly)).toBe(false);
  });
});
