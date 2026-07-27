import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
  Capability,
  ExecutionContext,
  ExecutionEvent,
  ExecutionRecord,
  Logger,
} from "@designflow/sdk";
import { ExecutionEngine } from "../engine";
import { CapabilityRegistry } from "../registry";
import { InMemoryExecutionRepository } from "../repository";
import { InMemoryEventPublisher } from "../events";
import { InMemoryArtifactStore } from "./in-memory-artifact-store";

// ── Helpers ─────────────────────────────────────────────────────

const createLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

/** A capability that emits one artifact reference with a stable id. */
const emitting = (
  id: string,
  artifactId: string,
  artifactType: string,
): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => ({
    artifactRef: {
      id: artifactId,
      type: artifactType,
      metadata: { producedBy: id },
    },
  }),
});

/**
 * A capability whose emitted artifact metadata is controlled by the test, so a
 * second run can emit the same logical artifact with changed content.
 */
const mutating = (
  id: string,
  artifactId: string,
  metadata: { current: Record<string, unknown> },
): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => ({
    artifactRef: {
      id: artifactId,
      type: "ui.ir",
      metadata: metadata.current,
    },
  }),
});

interface Harness {
  readonly engine: ExecutionEngine;
  readonly registry: CapabilityRegistry;
  readonly artifactStore: InMemoryArtifactStore;
  readonly repository: InMemoryExecutionRepository;
  readonly events: ExecutionEvent[];
}

const createHarness = (): Harness => {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher();
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const artifactStore = new InMemoryArtifactStore({ eventPublisher });
  const repository = new InMemoryExecutionRepository();
  const registry = new CapabilityRegistry();

  const engine = new ExecutionEngine(
    registry,
    createLogger(),
    artifactStore,
    repository,
    eventPublisher,
  );

  return { engine, registry, artifactStore, repository, events };
};

const createContext = (
  executionId: string,
  workflowId: string,
): ExecutionContext => ({
  runId: executionId,
  workflowId,
  stateRef: "test",
  artifacts: [],
  metadata: {},
  signal: new AbortController().signal,
});

const startExecution = async (
  repository: InMemoryExecutionRepository,
  executionId: string,
  workflowId: string,
): Promise<void> => {
  const record: ExecutionRecord = {
    executionId,
    workflowId,
    status: "running",
    startedAt: Date.now(),
  };
  await repository.create(record);
};

/**
 * Figma JSON -> UI IR -> Generated Code -> Validated Patch, one capability
 * per compiler pass.
 */
const pipelineDefinition = {
  id: "wf-design-pipeline",
  name: "design pipeline",
  description: "",
  nodes: [
    { id: "parse", capabilityId: "cap-parse", inputMap: {} },
    {
      id: "lower",
      capabilityId: "cap-lower",
      inputMap: {},
      execution: { dependsOn: ["parse"] },
    },
    {
      id: "codegen",
      capabilityId: "cap-codegen",
      inputMap: {},
      execution: { dependsOn: ["lower"] },
    },
    {
      id: "validate",
      capabilityId: "cap-validate",
      inputMap: {},
      execution: { dependsOn: ["codegen"] },
    },
  ],
  metadata: {},
};

const registerPipeline = (registry: CapabilityRegistry): void => {
  registry.register(emitting("cap-parse", "figma-json", "figma.json"));
  registry.register(emitting("cap-lower", "ui-ir", "ui.ir"));
  registry.register(emitting("cap-codegen", "generated-code", "code"));
  registry.register(emitting("cap-validate", "validated-patch", "patch"));
};

// ── 8. Capability output creates artifact ───────────────────────

describe("capability output registration", () => {
  test("registers an artifact for every capability-produced reference", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    registerPipeline(registry);

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, pipelineDefinition.id);

    const result = await engine.run(
      pipelineDefinition,
      createContext(executionId, pipelineDefinition.id),
    );

    expect(result.success).toBe(true);

    for (const id of [
      "figma-json",
      "ui-ir",
      "generated-code",
      "validated-patch",
    ]) {
      const artifact = await artifactStore.getArtifact(id);
      expect(artifact).not.toBeNull();
      expect(artifact?.version).toBe(1);
    }

    expect((await artifactStore.getArtifact("ui-ir"))?.type).toBe("ui.ir");
    expect((await artifactStore.getArtifact("ui-ir"))?.metadata).toEqual({
      producedBy: "cap-lower",
    });
  });

  test("creates version 1 for each registered artifact", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    registerPipeline(registry);

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(executionId, pipelineDefinition.id),
    );

    const version = await artifactStore.getVersion("generated-code", 1);
    expect(version?.artifactId).toBe("generated-code");
    expect(version?.hash.length).toBe(64);
  });

  test("links each artifact to the artifacts it was built from", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    registerPipeline(registry);

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(executionId, pipelineDefinition.id),
    );

    const lineage = await artifactStore.getLineage("validated-patch");

    // A linear pipeline accumulates predecessors, so the leaf points at every
    // upstream artifact; nearest-first ordering still reconstructs the chain.
    expect(lineage.ancestors).toContain("generated-code");
    expect(lineage.ancestors).toContain("ui-ir");
    expect(lineage.ancestors).toContain("figma-json");
    expect(lineage.descendants).toEqual([]);

    const root = await artifactStore.getLineage("figma-json");
    expect(root.ancestors).toEqual([]);
    expect(root.descendants).toContain("validated-patch");
  });

  test("leaves a payload-only artifact store untouched", async () => {
    const saved: unknown[] = [];
    const payloadOnly = {
      save: async (data: unknown) => {
        saved.push(data);
        return { id: "payload-artifact", type: "test", metadata: {} };
      },
      get: async () => null,
      exists: async () => false,
    };

    const registry = new CapabilityRegistry();
    registry.register(emitting("cap-parse", "figma-json", "figma.json"));

    const repository = new InMemoryExecutionRepository();
    const engine = new ExecutionEngine(
      registry,
      createLogger(),
      payloadOnly,
      repository,
      new InMemoryEventPublisher(),
    );

    const definition = {
      id: "wf-payload-only",
      name: "payload only",
      description: "",
      nodes: [{ id: "parse", capabilityId: "cap-parse", inputMap: {} }],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, definition.id);

    const result = await engine.run(
      definition,
      createContext(executionId, definition.id),
    );

    expect(result.success).toBe(true);
    expect(result.artifacts).toHaveLength(1);
  });
});

// ── Version creation from capability emissions ──────────────────

describe("artifact versioning across executions", () => {
  const singleNode = {
    id: "wf-versioned",
    name: "versioned",
    description: "",
    nodes: [{ id: "emit", capabilityId: "cap-emit", inputMap: {} }],
    metadata: {},
  };

  const runOnce = async (
    engine: ExecutionEngine,
    repository: InMemoryExecutionRepository,
  ): Promise<string> => {
    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, singleNode.id);
    const result = await engine.run(
      singleNode,
      createContext(executionId, singleNode.id),
    );
    expect(result.success).toBe(true);
    return executionId;
  };

  test("creates a new version when a later run changes the artifact", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    const emitted = { current: { tokens: 12 } as Record<string, unknown> };
    registry.register(mutating("cap-emit", "ui-ir", emitted));

    await runOnce(engine, repository);
    expect((await artifactStore.getArtifact("ui-ir"))?.version).toBe(1);

    emitted.current = { tokens: 34 };
    await runOnce(engine, repository);

    expect((await artifactStore.getArtifact("ui-ir"))?.version).toBe(2);
    expect((await artifactStore.getVersion("ui-ir", 1))?.metadata).toEqual({
      tokens: 12,
    });
    expect((await artifactStore.getVersion("ui-ir", 2))?.metadata).toEqual({
      tokens: 34,
    });

    emitted.current = { tokens: 56 };
    await runOnce(engine, repository);
    expect((await artifactStore.getArtifact("ui-ir"))?.version).toBe(3);
  });

  test("does not version an unchanged re-emission", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    const emitted = { current: { tokens: 12 } as Record<string, unknown> };
    registry.register(mutating("cap-emit", "ui-ir", emitted));

    await runOnce(engine, repository);
    await runOnce(engine, repository);
    await runOnce(engine, repository);

    expect((await artifactStore.getArtifact("ui-ir"))?.version).toBe(1);
  });

  test("treats reordered keys as unchanged content", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    const emitted = { current: { a: 1, b: 2 } as Record<string, unknown> };
    registry.register(mutating("cap-emit", "ui-ir", emitted));

    await runOnce(engine, repository);
    emitted.current = { b: 2, a: 1 };
    await runOnce(engine, repository);

    expect((await artifactStore.getArtifact("ui-ir"))?.version).toBe(1);
  });

  test("keeps the origin provenance while versioning", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    const emitted = { current: { tokens: 12 } as Record<string, unknown> };
    registry.register(mutating("cap-emit", "ui-ir", emitted));

    const firstExecution = await runOnce(engine, repository);

    emitted.current = { tokens: 34 };
    await runOnce(engine, repository);

    const artifact = await artifactStore.getArtifact("ui-ir");
    expect(artifact?.version).toBe(2);
    expect(artifact?.provenance?.executionId).toBe(firstExecution);
    expect(artifact?.provenance?.capabilityId).toBe("cap-emit");

    // Identity metadata is fixed at registration; revisions live on versions.
    expect(artifact?.metadata).toEqual({ tokens: 12 });
  });

  test("emits artifact.version_created on the versioning execution", async () => {
    const { engine, registry, repository, events } = createHarness();
    const emitted = { current: { tokens: 12 } as Record<string, unknown> };
    registry.register(mutating("cap-emit", "ui-ir", emitted));

    await runOnce(engine, repository);
    events.length = 0;

    emitted.current = { tokens: 34 };
    const secondExecution = await runOnce(engine, repository);

    const versionEvents = events.filter(
      (event) => event.type === "artifact.version_created",
    );

    expect(versionEvents).toHaveLength(1);
    expect(versionEvents[0]?.payload).toEqual({
      artifactId: "ui-ir",
      version: 2,
    });

    // Provenance owns event attribution, so the event lands on the execution
    // that first registered the artifact, not the one that versioned it.
    expect(versionEvents[0]?.executionId).not.toBe(secondExecution);
  });

  test("content-addressed payloads yield a new artifact, not a new version", async () => {
    const { artifactStore } = createHarness();

    const first = await artifactStore.save({ tokens: 12 });
    const second = await artifactStore.save({ tokens: 34 });

    expect(second.id).not.toBe(first.id);
    expect((await artifactStore.getArtifact(first.id))?.version).toBe(1);
    expect((await artifactStore.getArtifact(second.id))?.version).toBe(1);
  });
});

// ── 9. Provenance stored correctly ──────────────────────────────

describe("provenance", () => {
  test("records execution, workflow and capability identity", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    registerPipeline(registry);

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(executionId, pipelineDefinition.id),
    );

    expect((await artifactStore.getArtifact("ui-ir"))?.provenance).toEqual({
      executionId,
      workflowId: "wf-design-pipeline",
      capabilityId: "cap-lower",
    });

    expect(
      (await artifactStore.getArtifact("validated-patch"))?.provenance,
    ).toEqual({
      executionId,
      workflowId: "wf-design-pipeline",
      capabilityId: "cap-validate",
    });
  });

  test("keeps the originating execution when a later run re-emits the artifact", async () => {
    const { engine, registry, artifactStore, repository } = createHarness();
    registerPipeline(registry);

    const firstExecution = crypto.randomUUID();
    await startExecution(repository, firstExecution, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(firstExecution, pipelineDefinition.id),
    );

    const secondExecution = crypto.randomUUID();
    await startExecution(repository, secondExecution, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(secondExecution, pipelineDefinition.id),
    );

    const artifact = await artifactStore.getArtifact("ui-ir");
    expect(artifact?.provenance?.executionId).toBe(firstExecution);

    // Resolving an existing artifact must not fabricate a new version.
    expect(artifact?.version).toBe(1);
  });

  test("checkpoints carry artifact references, never payloads", async () => {
    const { engine, registry, repository } = createHarness();
    registerPipeline(registry);

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(executionId, pipelineDefinition.id),
    );

    const checkpoint = await repository.getLatestCheckpoint(executionId);
    const applied = checkpoint?.metadata?.appliedArtifacts;

    expect(Array.isArray(applied)).toBe(true);

    const serialized = JSON.stringify(applied);
    expect(serialized).toContain("validated-patch");
    expect(serialized).not.toContain("\"data\"");
  });
});

// ── 10. Artifact events emitted during execution ────────────────

describe("artifact events during execution", () => {
  test("emits created, version_created and relation_added events", async () => {
    const { engine, registry, repository, events } = createHarness();
    registerPipeline(registry);

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(executionId, pipelineDefinition.id),
    );

    const artifactEvents = events.filter((event) =>
      event.type.startsWith("artifact."),
    );

    const created = artifactEvents.filter(
      (event) => event.type === "artifact.created",
    );
    const versioned = artifactEvents.filter(
      (event) => event.type === "artifact.version_created",
    );
    const related = artifactEvents.filter(
      (event) => event.type === "artifact.relation_added",
    );

    expect(created).toHaveLength(4);
    expect(versioned).toHaveLength(4);
    expect(related.length).toBeGreaterThan(0);

    expect(
      created.every((event) => event.executionId === executionId),
    ).toBe(true);

    expect(
      created.map((event) => event.payload?.artifactId),
    ).toEqual([
      "figma-json",
      "ui-ir",
      "generated-code",
      "validated-patch",
    ]);

    expect(created[0]?.payload).toEqual({
      artifactId: "figma-json",
      version: 1,
    });
  });

  test("orders artifact.created before the relations that reference it", async () => {
    const { engine, registry, repository, events } = createHarness();
    registerPipeline(registry);

    const executionId = crypto.randomUUID();
    await startExecution(repository, executionId, pipelineDefinition.id);
    await engine.run(
      pipelineDefinition,
      createContext(executionId, pipelineDefinition.id),
    );

    const sequence = events
      .filter((event) => event.type.startsWith("artifact."))
      .map((event) => `${event.type}:${String(event.payload?.artifactId)}`);

    const createdIndex = sequence.indexOf("artifact.created:ui-ir");
    const relationIndex = sequence.indexOf("artifact.relation_added:ui-ir");

    expect(createdIndex).toBeGreaterThanOrEqual(0);
    expect(relationIndex).toBeGreaterThan(createdIndex);
  });
});
