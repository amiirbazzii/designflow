import { describe, expect, test } from "bun:test";
import type { ExecutionEvent } from "@designflow/sdk";
import { DesignFlowError } from "@designflow/sdk";
import { InMemoryArtifactStore } from "./in-memory-artifact-store";
import { ArtifactIntelligenceService } from "./intelligence";
import { InMemoryEventPublisher } from "../events";

// ── Helpers ─────────────────────────────────────────────────────

interface Fixture {
  readonly store: InMemoryArtifactStore;
  readonly intelligence: ArtifactIntelligenceService;
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
    intelligence: new ArtifactIntelligenceService({
      registry: store,
      eventPublisher,
    }),
    events,
  };
};

const register = async (
  store: InMemoryArtifactStore,
  id: string,
  options?: {
    readonly workflowId?: string;
    readonly executionId?: string;
    readonly capabilityId?: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<void> => {
  await store.createArtifact({
    id,
    type: "test",
    metadata: options?.metadata ?? {},
    provenance: {
      executionId: options?.executionId ?? "exec-123",
      workflowId: options?.workflowId ?? "design-to-code",
      capabilityId: options?.capabilityId ?? `cap-${id}`,
    },
  });
};

/**
 * Figma JSON <- UI IR <- Generated Code <- Validated Patch.
 * Edges point from each artifact toward what it came from.
 */
const buildPipeline = async (fixture: Fixture): Promise<void> => {
  const { store } = fixture;

  await register(store, "figma-json");
  await register(store, "ui-ir");
  await register(store, "generated-code");
  await register(store, "validated-patch");

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

// ── 1. Dependency query ─────────────────────────────────────────

describe("getDependencies", () => {
  test("returns the full transitive chain, nearest first", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const result = await fixture.intelligence.getDependencies(
      "validated-patch",
    );

    expect(result.artifactId).toBe("validated-patch");
    expect(result.dependencies).toEqual([
      "generated-code",
      "ui-ir",
      "figma-json",
    ]);
    expect(result.dependents).toEqual([]);
  });

  test("returns an empty chain for the root artifact", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const result = await fixture.intelligence.getDependencies("figma-json");

    expect(result.dependencies).toEqual([]);
  });

  test("ignores supersession edges", async () => {
    const fixture = createFixture();
    await register(fixture.store, "old");
    await register(fixture.store, "new");

    await fixture.store.addRelation({
      sourceArtifactId: "old",
      targetArtifactId: "new",
      relation: "replaced_by",
    });

    // A replacement is not something an artifact was built from.
    const result = await fixture.intelligence.getDependencies("old");
    expect(result.dependencies).toEqual([]);
    expect(result.dependents).toEqual([]);
  });

  test("rejects an unknown artifact", async () => {
    const fixture = createFixture();

    await expectCode(
      fixture.intelligence.getDependencies("missing"),
      "ERR_ARTIFACT_NOT_FOUND",
    );
  });
});

// ── 2. Dependent query ──────────────────────────────────────────

describe("getDependents", () => {
  test("returns everything built from the artifact, nearest first", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const result = await fixture.intelligence.getDependents("figma-json");

    expect(result.dependents).toEqual([
      "ui-ir",
      "generated-code",
      "validated-patch",
    ]);
    expect(result.dependencies).toEqual([]);
  });

  test("reports both directions from mid-chain", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const result = await fixture.intelligence.getDependents("ui-ir");

    expect(result.dependencies).toEqual(["figma-json"]);
    expect(result.dependents).toEqual(["generated-code", "validated-patch"]);
  });

  test("returns an empty chain for a leaf", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const result = await fixture.intelligence.getDependents("validated-patch");

    expect(result.dependents).toEqual([]);
  });
});

// ── 3. Impact analysis ──────────────────────────────────────────

describe("analyzeImpact", () => {
  test("reports everything a change invalidates downstream", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const impact = await fixture.intelligence.analyzeImpact("ui-ir");

    expect(impact.artifactId).toBe("ui-ir");
    expect(impact.affectedArtifacts).toEqual([
      "generated-code",
      "validated-patch",
    ]);
  });

  test("reports nothing affected for a leaf artifact", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const impact = await fixture.intelligence.analyzeImpact("validated-patch");

    expect(impact.affectedArtifacts).toEqual([]);
    expect(impact.affectedWorkflows).toEqual([]);
    expect(impact.affectedExecutions).toEqual([]);
  });

  test("validates the version when one is supplied", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const impact = await fixture.intelligence.analyzeImpact("ui-ir", 1);
    expect(impact.affectedArtifacts).toHaveLength(2);

    await expectCode(
      fixture.intelligence.analyzeImpact("ui-ir", 7),
      "ERR_ARTIFACT_VERSION_NOT_FOUND",
    );
  });

  test("rejects an unknown artifact", async () => {
    const fixture = createFixture();

    await expectCode(
      fixture.intelligence.analyzeImpact("missing"),
      "ERR_ARTIFACT_NOT_FOUND",
    );
  });
});

// ── 4. Workflow impact detection ────────────────────────────────

describe("workflow impact", () => {
  test("reports the workflows that produced the affected artifacts", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const impact = await fixture.intelligence.analyzeImpact("ui-ir");

    expect(impact.affectedWorkflows).toEqual(["design-to-code"]);
  });

  test("deduplicates and reports every distinct downstream workflow", async () => {
    const fixture = createFixture();
    const { store } = fixture;

    await register(store, "tokens", { workflowId: "wf-tokens" });
    await register(store, "css", { workflowId: "wf-css" });
    await register(store, "docs", { workflowId: "wf-docs" });
    await register(store, "site", { workflowId: "wf-css" });

    for (const child of ["css", "docs", "site"]) {
      await store.addRelation({
        sourceArtifactId: child,
        targetArtifactId: "tokens",
        relation: "derived_from",
      });
    }

    const impact = await fixture.intelligence.analyzeImpact("tokens");

    expect(impact.affectedArtifacts.sort()).toEqual(["css", "docs", "site"]);
    expect(impact.affectedWorkflows.sort()).toEqual(["wf-css", "wf-docs"]);
  });

  test("excludes the subject's own workflow when nothing downstream uses it", async () => {
    const fixture = createFixture();
    const { store } = fixture;

    await register(store, "root", { workflowId: "wf-root" });
    await register(store, "child", { workflowId: "wf-child" });
    await store.addRelation({
      sourceArtifactId: "child",
      targetArtifactId: "root",
      relation: "derived_from",
    });

    const impact = await fixture.intelligence.analyzeImpact("root");

    // The subject's own execution already ran; only downstream work is stale.
    expect(impact.affectedWorkflows).toEqual(["wf-child"]);
  });
});

// ── 5. Execution impact detection ───────────────────────────────

describe("execution impact", () => {
  test("reports the executions that need rerunning", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);

    const impact = await fixture.intelligence.analyzeImpact("ui-ir");

    expect(impact.affectedExecutions).toEqual(["exec-123"]);
  });

  test("reports every distinct downstream execution", async () => {
    const fixture = createFixture();
    const { store } = fixture;

    await register(store, "tokens", { executionId: "exec-1" });
    await register(store, "css", { executionId: "exec-2" });
    await register(store, "docs", { executionId: "exec-3" });

    for (const child of ["css", "docs"]) {
      await store.addRelation({
        sourceArtifactId: child,
        targetArtifactId: "tokens",
        relation: "derived_from",
      });
    }

    const impact = await fixture.intelligence.analyzeImpact("tokens");

    expect(impact.affectedExecutions.sort()).toEqual(["exec-2", "exec-3"]);
    expect(impact.affectedExecutions).not.toContain("exec-1");
  });

  test("skips affected artifacts that carry no provenance", async () => {
    const fixture = createFixture();
    const { store } = fixture;

    await register(store, "root");
    await store.createArtifact({ id: "orphan", type: "test", metadata: {} });
    await store.addRelation({
      sourceArtifactId: "orphan",
      targetArtifactId: "root",
      relation: "derived_from",
    });

    const impact = await fixture.intelligence.analyzeImpact("root");

    expect(impact.affectedArtifacts).toEqual(["orphan"]);
    expect(impact.affectedExecutions).toEqual([]);
  });

  test("emits artifact.impact_analyzed", async () => {
    const fixture = createFixture();
    await buildPipeline(fixture);
    fixture.events.length = 0;

    await fixture.intelligence.analyzeImpact("ui-ir");

    const emitted = fixture.events.filter(
      (event) => event.type === "artifact.impact_analyzed",
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.executionId).toBe("exec-123");
    expect(emitted[0]?.payload?.artifactId).toBe("ui-ir");
    expect(emitted[0]?.payload?.affectedCount).toBe(2);
  });
});

// ── 6. Version diff ─────────────────────────────────────────────

describe("diffVersions", () => {
  test("reports a changed value between versions", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", {
      metadata: { components: 10, buttons: 5 },
    });
    await fixture.store.createVersion("ui-ir", {
      components: 12,
      buttons: 5,
    });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.artifactId).toBe("ui-ir");
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    expect(diff.changed).toBe(true);
    expect(diff.metadataChanges?.modified).toEqual(["components"]);
    expect(diff.metadataChanges?.added).toEqual([]);
    expect(diff.metadataChanges?.removed).toEqual([]);
  });

  test("reports no change for identical content", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", { metadata: { components: 10 } });
    await fixture.store.createVersion("ui-ir", { components: 10 });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.changed).toBe(false);
    expect(diff.metadataChanges).toEqual({
      added: [],
      removed: [],
      modified: [],
    });
  });

  test("uses canonical comparison for reordered keys", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", {
      metadata: { nested: { a: 1, b: 2 } },
    });
    await fixture.store.createVersion("ui-ir", { nested: { b: 2, a: 1 } });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.changed).toBe(false);
    expect(diff.metadataChanges?.modified).toEqual([]);
  });

  test("diffs across non-adjacent versions", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", { metadata: { n: 1 } });
    await fixture.store.createVersion("ui-ir", { n: 2 });
    await fixture.store.createVersion("ui-ir", { n: 3 });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 3);

    expect(diff.changed).toBe(true);
    expect(diff.metadataChanges?.modified).toEqual(["n"]);
  });

  test("rejects an unknown version on either side", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", { metadata: { n: 1 } });

    await expectCode(
      fixture.intelligence.diffVersions("ui-ir", 1, 9),
      "ERR_ARTIFACT_VERSION_NOT_FOUND",
    );
    await expectCode(
      fixture.intelligence.diffVersions("ui-ir", 9, 1),
      "ERR_ARTIFACT_VERSION_NOT_FOUND",
    );
    await expectCode(
      fixture.intelligence.diffVersions("missing", 1, 2),
      "ERR_ARTIFACT_VERSION_NOT_FOUND",
    );
  });

  test("emits artifact.diff_created", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", { metadata: { n: 1 } });
    await fixture.store.createVersion("ui-ir", { n: 2 });
    fixture.events.length = 0;

    await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    const emitted = fixture.events.filter(
      (event) => event.type === "artifact.diff_created",
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.payload).toEqual({
      artifactId: "ui-ir",
      fromVersion: 1,
      toVersion: 2,
      changed: true,
    });
  });
});

// ── 7. Added metadata detection ─────────────────────────────────

describe("added metadata", () => {
  test("reports keys present only in the newer version", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", { metadata: { components: 10 } });
    await fixture.store.createVersion("ui-ir", {
      components: 10,
      density: "compact",
      theme: "dark",
    });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.changed).toBe(true);
    expect(diff.metadataChanges?.added).toEqual(["density", "theme"]);
    expect(diff.metadataChanges?.removed).toEqual([]);
    expect(diff.metadataChanges?.modified).toEqual([]);
  });

  test("treats an explicit undefined value as an added key", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", { metadata: {} });
    await fixture.store.createVersion("ui-ir", { flag: undefined });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.metadataChanges?.added).toEqual(["flag"]);
  });
});

// ── 8. Removed metadata detection ───────────────────────────────

describe("removed metadata", () => {
  test("reports keys present only in the older version", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", {
      metadata: { components: 10, legacy: true, deprecated: "yes" },
    });
    await fixture.store.createVersion("ui-ir", { components: 10 });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.changed).toBe(true);
    expect(diff.metadataChanges?.removed).toEqual(["deprecated", "legacy"]);
    expect(diff.metadataChanges?.added).toEqual([]);
    expect(diff.metadataChanges?.modified).toEqual([]);
  });

  test("handles a version with no metadata at all", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", { metadata: { components: 10 } });
    await fixture.store.createVersion("ui-ir");

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.changed).toBe(true);
    expect(diff.metadataChanges?.removed).toEqual(["components"]);
  });
});

// ── 9. Modified metadata detection ──────────────────────────────

describe("modified metadata", () => {
  test("reports only the keys whose value changed", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", {
      metadata: { components: 10, buttons: 5, theme: "dark" },
    });
    await fixture.store.createVersion("ui-ir", {
      components: 12,
      buttons: 5,
      theme: "light",
    });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.metadataChanges?.modified).toEqual(["components", "theme"]);
    expect(diff.metadataChanges?.added).toEqual([]);
    expect(diff.metadataChanges?.removed).toEqual([]);
  });

  test("detects a change nested inside a value", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", {
      metadata: { counts: { components: 10 } },
    });
    await fixture.store.createVersion("ui-ir", {
      counts: { components: 12 },
    });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.metadataChanges?.modified).toEqual(["counts"]);
  });

  test("reports additions, removals and modifications together", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir", {
      metadata: { kept: 1, changed: "before", dropped: true },
    });
    await fixture.store.createVersion("ui-ir", {
      kept: 1,
      changed: "after",
      introduced: 42,
    });

    const diff = await fixture.intelligence.diffVersions("ui-ir", 1, 2);

    expect(diff.metadataChanges).toEqual({
      added: ["introduced"],
      removed: ["dropped"],
      modified: ["changed"],
    });
  });
});

// ── 10. Reusable artifact detection ─────────────────────────────

describe("findReusableArtifacts", () => {
  test("reports an artifact at the observed version as reusable", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir");
    await register(fixture.store, "figma-json");

    const report = await fixture.intelligence.findReusableArtifacts([
      { artifactId: "ui-ir", version: 1 },
      { artifactId: "figma-json", version: 1 },
    ]);

    expect(report.allReusable).toBe(true);
    expect(report.reusable).toEqual(["ui-ir", "figma-json"]);
    expect(report.candidates[0]?.reason).toBe("unchanged");
    expect(report.candidates[0]?.currentVersion).toBe(1);
  });

  test("treats an omitted version as an existence check", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir");
    await fixture.store.createVersion("ui-ir", { n: 2 });

    const report = await fixture.intelligence.findReusableArtifacts([
      { artifactId: "ui-ir" },
    ]);

    expect(report.allReusable).toBe(true);
    expect(report.candidates[0]?.currentVersion).toBe(2);
    expect(report.candidates[0]?.requestedVersion).toBeUndefined();
  });

  test("reports a missing artifact as not reusable", async () => {
    const fixture = createFixture();

    const report = await fixture.intelligence.findReusableArtifacts([
      { artifactId: "missing", version: 1 },
    ]);

    expect(report.allReusable).toBe(false);
    expect(report.reusable).toEqual([]);
    expect(report.candidates[0]?.reason).toBe("missing");
    expect(report.candidates[0]?.currentVersion).toBeUndefined();
  });

  test("reports an empty request as not reusable", async () => {
    const fixture = createFixture();

    const report = await fixture.intelligence.findReusableArtifacts([]);

    // Nothing to reuse is not the same as everything being reusable.
    expect(report.allReusable).toBe(false);
    expect(report.candidates).toEqual([]);
  });
});

// ── 11. Changed artifact is not reusable ────────────────────────

describe("reuse invalidation", () => {
  test("an artifact that advanced past the observed version is not reusable", async () => {
    const fixture = createFixture();
    await register(fixture.store, "ui-ir");
    await fixture.store.createVersion("ui-ir", { n: 2 });

    const report = await fixture.intelligence.findReusableArtifacts([
      { artifactId: "ui-ir", version: 1 },
    ]);

    expect(report.allReusable).toBe(false);
    expect(report.reusable).toEqual([]);
    expect(report.candidates[0]?.reason).toBe("version_changed");
    expect(report.candidates[0]?.requestedVersion).toBe(1);
    expect(report.candidates[0]?.currentVersion).toBe(2);
  });

  test("one changed dependency invalidates the whole set", async () => {
    const fixture = createFixture();
    await register(fixture.store, "figma-json");
    await register(fixture.store, "ui-ir");
    await fixture.store.createVersion("ui-ir", { n: 2 });

    const report = await fixture.intelligence.findReusableArtifacts([
      { artifactId: "figma-json", version: 1 },
      { artifactId: "ui-ir", version: 1 },
    ]);

    expect(report.allReusable).toBe(false);
    expect(report.reusable).toEqual(["figma-json"]);
  });

  test("preserves request order in the report", async () => {
    const fixture = createFixture();
    await register(fixture.store, "a");
    await register(fixture.store, "b");
    await register(fixture.store, "c");

    const report = await fixture.intelligence.findReusableArtifacts([
      { artifactId: "c" },
      { artifactId: "a" },
      { artifactId: "b" },
    ]);

    expect(report.reusable).toEqual(["c", "a", "b"]);
  });
});

// ── Event attribution ───────────────────────────────────────────

describe("event attribution", () => {
  test("publishes nothing for an artifact registered outside an execution", async () => {
    const fixture = createFixture();
    await fixture.store.createArtifact({
      id: "orphan",
      type: "test",
      metadata: { n: 1 },
    });
    await fixture.store.createVersion("orphan", { n: 2 });
    fixture.events.length = 0;

    await fixture.intelligence.analyzeImpact("orphan");
    await fixture.intelligence.diffVersions("orphan", 1, 2);

    expect(fixture.events).toHaveLength(0);
  });

  test("works without an event publisher configured", async () => {
    const store = new InMemoryArtifactStore();
    const intelligence = new ArtifactIntelligenceService({ registry: store });

    await register(store, "ui-ir", { metadata: { n: 1 } });
    await store.createVersion("ui-ir", { n: 2 });

    const diff = await intelligence.diffVersions("ui-ir", 1, 2);
    expect(diff.changed).toBe(true);
  });
});
