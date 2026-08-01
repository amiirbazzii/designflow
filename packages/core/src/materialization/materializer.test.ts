// packages/core/src/materialization/materializer.test.ts
import { describe, expect, test } from "bun:test";
import {
  type Artifact,
  type ArtifactRegistry,
  type ArtifactVersion,
  type ExecutionEvent,
  DesignFlowError,
} from "@designflow/sdk";

import { RegistryArtifactMaterializer } from "./materializer";
import { checkArtifact, resolveSourceExecutionId } from "./validation";
import { InMemoryArtifactStore } from "../artifacts";
import { InMemoryEventPublisher } from "../events";

// ── Helpers ─────────────────────────────────────────────────────

interface Fixture {
  readonly store: InMemoryArtifactStore;
  readonly materializer: RegistryArtifactMaterializer;
  readonly events: ExecutionEvent[];
}

const createFixture = (): Fixture => {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher();
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const store = new InMemoryArtifactStore({ eventPublisher });

  return {
    store,
    materializer: new RegistryArtifactMaterializer({
      registry: store,
      eventPublisher,
    }),
    events,
  };
};

const seed = async (
  store: InMemoryArtifactStore,
  id: string,
  options?: {
    readonly executionId?: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> => {
  await store.createArtifact({
    id,
    type: "ui.ir",
    metadata: options?.metadata ?? {},
    provenance: {
      executionId: options?.executionId ?? "exec-source",
      workflowId: "design-to-code",
      capabilityId: "cap-transform",
    },
  });
};

const request = (artifactIds: readonly string[]) => ({
  nodeId: "transform",
  capabilityId: "cap-transform",
  executionId: "exec-current",
  artifactIds: [...artifactIds],
});

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

// ── 1. Validates artifact existence ─────────────────────────────

describe("materialize", () => {
  test("returns validated references for registered artifacts", async () => {
    const fixture = createFixture();
    await seed(fixture.store, "ui-ir", { metadata: { components: 12 } });
    await seed(fixture.store, "figma-json");

    const result = await fixture.materializer.materialize(
      request(["ui-ir", "figma-json"]),
    );

    expect(result.success).toBe(true);
    expect(result.artifacts.map((a) => a.id)).toEqual(["ui-ir", "figma-json"]);
    expect(result.artifacts[0]?.type).toBe("ui.ir");
    expect(result.artifacts[0]?.metadata).toEqual({ components: 12 });
  });

  test("reports the source execution when every artifact agrees", async () => {
    const fixture = createFixture();
    await seed(fixture.store, "ui-ir", { executionId: "exec-1" });
    await seed(fixture.store, "figma-json", { executionId: "exec-1" });

    const result = await fixture.materializer.materialize(
      request(["ui-ir", "figma-json"]),
    );

    expect(result.sourceExecutionId).toBe("exec-1");
  });

  test("omits the source execution when artifacts span several runs", async () => {
    const fixture = createFixture();
    await seed(fixture.store, "ui-ir", { executionId: "exec-1" });
    await seed(fixture.store, "figma-json", { executionId: "exec-2" });

    const result = await fixture.materializer.materialize(
      request(["ui-ir", "figma-json"]),
    );

    // Reporting one run's id for a mixed set would misattribute the others.
    expect(result.sourceExecutionId).toBeUndefined();
  });

  test("omits the source execution for an artifact without provenance", async () => {
    const fixture = createFixture();
    await fixture.store.createArtifact({
      id: "orphan",
      type: "ui.ir",
      metadata: {},
    });

    const result = await fixture.materializer.materialize(request(["orphan"]));

    expect(result.success).toBe(true);
    expect(result.sourceExecutionId).toBeUndefined();
  });

  test("succeeds trivially for an empty request", async () => {
    const fixture = createFixture();

    const result = await fixture.materializer.materialize(request([]));

    expect(result.success).toBe(true);
    expect(result.artifacts).toEqual([]);
  });

  test("rejects a malformed request at the boundary", async () => {
    const fixture = createFixture();

    await expect(
      fixture.materializer.materialize({
        nodeId: "",
        capabilityId: "cap-transform",
        executionId: "exec-current",
        artifactIds: [],
      }),
    ).rejects.toThrow();
  });
});

// ── 2. Rejects unknown artifacts ────────────────────────────────

describe("unknown artifacts", () => {
  test("rejects an id that names nothing", async () => {
    const fixture = createFixture();

    const error = await expectCode(
      fixture.materializer.materialize(request(["never-registered"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );

    expect(JSON.stringify(error.metadata)).toContain("unknown_artifact");
    expect(JSON.stringify(error.metadata)).toContain("never-registered");
  });

  test("fails the whole request when one id is unknown", async () => {
    const fixture = createFixture();
    await seed(fixture.store, "ui-ir");

    await expectCode(
      fixture.materializer.materialize(request(["ui-ir", "ghost"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );
  });

  test("reports every offending id, not just the first", async () => {
    const fixture = createFixture();

    const error = await expectCode(
      fixture.materializer.materialize(request(["ghost-a", "ghost-b"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );

    const serialized = JSON.stringify(error.metadata);
    expect(serialized).toContain("ghost-a");
    expect(serialized).toContain("ghost-b");
  });

  test("carries the requesting node on the error", async () => {
    const fixture = createFixture();

    const error = await expectCode(
      fixture.materializer.materialize(request(["ghost"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );

    expect(error.metadata.nodeId).toBe("transform");
    expect(error.metadata.capabilityId).toBe("cap-transform");
    expect(error.metadata.executionId).toBe("exec-current");
  });
});

// ── 3. Resolves versions ────────────────────────────────────────

describe("version resolution", () => {
  test("resolves the artifact's current version", async () => {
    const fixture = createFixture();
    await seed(fixture.store, "ui-ir", { metadata: { n: 1 } });
    await fixture.store.createVersion("ui-ir", { n: 2 });

    const check = await checkArtifact(fixture.store, "ui-ir");

    expect(check.ok).toBe(true);
    expect(check.ok ? check.value.version : 0).toBe(2);
  });

  test("rejects an artifact whose version record is missing", async () => {
    // A registry that reports a version it cannot produce is inconsistent; a
    // reference built from it would claim a revision that does not exist.
    const inconsistent: ArtifactRegistry = {
      getArtifact: async (id: string): Promise<Artifact | null> => ({
        id,
        type: "ui.ir",
        version: 7,
        createdAt: 0,
        metadata: {},
      }),
      getVersion: async (): Promise<ArtifactVersion | null> => null,
      createArtifact: async () => {
        throw new Error("not used");
      },
      createVersion: async () => {
        throw new Error("not used");
      },
      addRelation: async () => {
        throw new Error("not used");
      },
      getLineage: async () => {
        throw new Error("not used");
      },
    };

    const materializer = new RegistryArtifactMaterializer({
      registry: inconsistent,
    });

    const error = await expectCode(
      materializer.materialize(request(["ui-ir"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );

    expect(JSON.stringify(error.metadata)).toContain("missing_version");
  });

  test("rejects a reference that cannot satisfy artifactRefSchema", async () => {
    const corrupt: ArtifactRegistry = {
      getArtifact: async (): Promise<Artifact | null> => ({
        id: "ui-ir",
        // An empty type fails artifactRefSchema's min(1) constraint.
        type: "",
        version: 1,
        createdAt: 0,
        metadata: {},
      }),
      getVersion: async (): Promise<ArtifactVersion | null> => ({
        artifactId: "ui-ir",
        version: 1,
        hash: "abc",
        createdAt: 0,
      }),
      createArtifact: async () => {
        throw new Error("not used");
      },
      createVersion: async () => {
        throw new Error("not used");
      },
      addRelation: async () => {
        throw new Error("not used");
      },
      getLineage: async () => {
        throw new Error("not used");
      },
    };

    const materializer = new RegistryArtifactMaterializer({
      registry: corrupt,
    });

    const error = await expectCode(
      materializer.materialize(request(["ui-ir"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );

    expect(JSON.stringify(error.metadata)).toContain("corrupt_reference");
  });

  test("reports unknown before version for a missing artifact", async () => {
    const fixture = createFixture();

    const error = await expectCode(
      fixture.materializer.materialize(request(["ghost"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );

    const serialized = JSON.stringify(error.metadata);
    expect(serialized).toContain("unknown_artifact");
    expect(serialized).not.toContain("missing_version");
  });
});

// ── 4. Successful materialization emits event ───────────────────

describe("artifact.materialized event", () => {
  test("emits one event per materialized artifact", async () => {
    const fixture = createFixture();
    await seed(fixture.store, "ui-ir", { executionId: "exec-1" });
    await seed(fixture.store, "figma-json", { executionId: "exec-1" });
    fixture.events.length = 0;

    await fixture.materializer.materialize(request(["ui-ir", "figma-json"]));

    const emitted = fixture.events.filter(
      (event) => event.type === "artifact.materialized",
    );

    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.executionId).toBe("exec-current");
    expect(emitted[0]?.payload).toEqual({
      nodeId: "transform",
      artifactId: "ui-ir",
      sourceExecutionId: "exec-1",
    });
  });

  test("omits sourceExecutionId when the artifact has no provenance", async () => {
    const fixture = createFixture();
    await fixture.store.createArtifact({
      id: "orphan",
      type: "ui.ir",
      metadata: {},
    });
    fixture.events.length = 0;

    await fixture.materializer.materialize(request(["orphan"]));

    const emitted = fixture.events.filter(
      (event) => event.type === "artifact.materialized",
    );

    expect(emitted[0]?.payload).toEqual({
      nodeId: "transform",
      artifactId: "orphan",
    });
  });

  test("emits nothing when any artifact fails validation", async () => {
    const fixture = createFixture();
    await seed(fixture.store, "ui-ir");
    fixture.events.length = 0;

    await expectCode(
      fixture.materializer.materialize(request(["ui-ir", "ghost"])),
      "ERR_ARTIFACT_MATERIALIZATION",
    );

    // Validation is all-or-nothing, so a partly valid request leaves no trace.
    expect(
      fixture.events.filter((e) => e.type === "artifact.materialized"),
    ).toHaveLength(0);
  });

  test("works without an event publisher configured", async () => {
    const store = new InMemoryArtifactStore();
    await seed(store, "ui-ir");

    const materializer = new RegistryArtifactMaterializer({ registry: store });
    const result = await materializer.materialize(request(["ui-ir"]));

    expect(result.success).toBe(true);
  });
});

// ── Source execution resolution ─────────────────────────────────

describe("resolveSourceExecutionId", () => {
  test("returns undefined for an empty set", () => {
    expect(resolveSourceExecutionId([])).toBeUndefined();
  });

  test("returns the shared id when all agree", () => {
    expect(
      resolveSourceExecutionId([
        { ref: { id: "a", type: "t", metadata: {} }, version: 1, sourceExecutionId: "e" },
        { ref: { id: "b", type: "t", metadata: {} }, version: 1, sourceExecutionId: "e" },
      ]),
    ).toBe("e");
  });

  test("returns undefined when one entry lacks provenance", () => {
    expect(
      resolveSourceExecutionId([
        { ref: { id: "a", type: "t", metadata: {} }, version: 1, sourceExecutionId: "e" },
        {
          ref: { id: "b", type: "t", metadata: {} },
          version: 1,
          sourceExecutionId: undefined,
        },
      ]),
    ).toBeUndefined();
  });
});
