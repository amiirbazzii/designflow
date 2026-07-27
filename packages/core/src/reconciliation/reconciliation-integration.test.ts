import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
  Capability,
  CapabilityReuseDecision,
  CapabilityReuseRequest,
  CapabilityReuseResolver,
  ExecutionContext,
  ExecutionEvent,
  ExecutionRecord,
  Logger,
  WorkflowDefinition,
} from "@designflow/sdk";
import { withChangedArtifacts, workflowDefinitionSchema } from "@designflow/sdk";
import { ExecutionEngine } from "../engine";
import { CapabilityRegistry } from "../registry";
import { InMemoryExecutionRepository } from "../repository";
import { InMemoryEventPublisher } from "../events";
import { InMemoryArtifactStore } from "../artifacts";
import { IncrementalExecutionPlannerService } from "../planning";
import { RegistryArtifactMaterializer } from "../materialization";
import { ArtifactSetReconciler } from "./reconciler";

// ── Fixtures ────────────────────────────────────────────────────

const createLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

const pipeline: WorkflowDefinition = workflowDefinitionSchema.parse({
  id: "design-to-code",
  name: "design to code",
  nodes: [
    { id: "parse", capabilityId: "cap-parse", produces: ["figma-json"] },
    {
      id: "transform",
      capabilityId: "cap-transform",
      produces: ["ui-ir"],
      execution: { dependsOn: ["parse"] },
    },
  ],
});

const emitting = (
  id: string,
  artifactId: string,
  calls: string[],
): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => {
    calls.push(id);
    return { artifactRef: { id: artifactId, type: "test", metadata: {} } };
  },
});

class ScriptedReuseResolver implements CapabilityReuseResolver {
  private readonly decide: (
    request: CapabilityReuseRequest,
  ) => CapabilityReuseDecision;

  public constructor(
    decide: (request: CapabilityReuseRequest) => CapabilityReuseDecision,
  ) {
    this.decide = decide;
  }

  public async resolve(
    request: CapabilityReuseRequest,
  ): Promise<CapabilityReuseDecision> {
    return this.decide(request);
  }
}

const reuseParse = (): ScriptedReuseResolver =>
  new ScriptedReuseResolver((request) =>
    request.nodeId === "parse"
      ? {
          reuse: true,
          artifacts: [{ id: "figma-json", type: "test", metadata: {} }],
        }
      : { reuse: false, artifacts: [] },
  );

interface Harness {
  readonly engine: ExecutionEngine;
  readonly repository: InMemoryExecutionRepository;
  readonly artifactStore: InMemoryArtifactStore;
  readonly events: ExecutionEvent[];
  readonly calls: string[];
}

const createHarness = (options?: {
  readonly incremental?: boolean;
  readonly withReconciler?: boolean;
}): Harness => {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher();
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const calls: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(emitting("cap-parse", "figma-json", calls));
  registry.register(emitting("cap-transform", "ui-ir", calls));

  const repository = new InMemoryExecutionRepository();
  const artifactStore = new InMemoryArtifactStore({ eventPublisher });

  const incremental = options?.incremental === true;

  const engine = new ExecutionEngine({
    registry,
    logger: createLogger(),
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    ...(incremental
      ? {
          incrementalPlanner: new IncrementalExecutionPlannerService({
            resolveWorkflow: (id) => (id === pipeline.id ? pipeline : undefined),
            executionRepository: repository,
          }),
          reuseResolver: reuseParse(),
          artifactMaterializer: new RegistryArtifactMaterializer({
            registry: artifactStore,
            eventPublisher,
          }),
        }
      : {}),
    ...(options?.withReconciler !== false
      ? {
          executionReconciler: new ArtifactSetReconciler({
            registry: artifactStore,
          }),
        }
      : {}),
  });

  return { engine, repository, artifactStore, events, calls };
};

const startExecution = async (
  repository: InMemoryExecutionRepository,
  executionId: string,
  status: ExecutionRecord["status"] = "running",
): Promise<void> => {
  await repository.create({
    executionId,
    workflowId: pipeline.id,
    status,
    startedAt: Date.now(),
  });
};

const plainContext = (executionId: string): ExecutionContext => ({
  runId: executionId,
  workflowId: pipeline.id,
  stateRef: "test",
  artifacts: [],
  metadata: {},
  signal: new AbortController().signal,
});

const incrementalContext = (executionId: string): ExecutionContext => ({
  ...plainContext(executionId),
  metadata: {
    ...withChangedArtifacts({}, ["ui-ir"]),
    previousExecutionId: "exec-previous",
  },
});

const seedArtifact = async (
  store: InMemoryArtifactStore,
  id: string,
): Promise<void> => {
  await store.createArtifact({
    id,
    type: "test",
    metadata: {},
    provenance: {
      executionId: "exec-previous",
      workflowId: pipeline.id,
      capabilityId: "cap-parse",
    },
  });
};

// ── 7. Incremental execution produces final graph ───────────────

describe("incremental execution", () => {
  test("reconciles reused and produced into the final artifact set", async () => {
    const harness = createHarness({ incremental: true });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual(["cap-transform"]);
    expect(result.artifacts.map((a) => a.id)).toEqual(["figma-json", "ui-ir"]);
  });

  test("stamps the resolved version onto each final artifact", async () => {
    const harness = createHarness({ incremental: true });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    // The next run reads these back as its previousArtifacts and compares
    // identities against them, so the version has to survive the round trip.
    expect(result.artifacts.every((a) => a.version === 1)).toBe(true);
  });

  test("records the reconciled set on the completion checkpoint", async () => {
    const harness = createHarness({ incremental: true });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, incrementalContext(executionId));

    const checkpoint = await harness.repository.getLatestCheckpoint(
      executionId,
    );
    const applied = checkpoint?.metadata?.appliedArtifacts;

    expect(JSON.stringify(applied)).toContain("figma-json");
    expect(JSON.stringify(applied)).toContain("ui-ir");
  });
});

// ── 8. Full execution bypasses reconciliation ───────────────────

describe("full execution", () => {
  test("runs every node and reports every artifact", async () => {
    const harness = createHarness();

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      plainContext(executionId),
    );

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual(["cap-parse", "cap-transform"]);
    expect(result.artifacts.map((a) => a.id)).toEqual(["figma-json", "ui-ir"]);
  });

  test("emits no reconciliation event without an incremental planner", async () => {
    const harness = createHarness();

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, plainContext(executionId));

    // A reconciler is configured, but a full run has nothing to reconcile
    // against — the merge would be an identity function.
    expect(
      harness.events.filter((e) => e.type === "execution.reconciled"),
    ).toHaveLength(0);
  });

  test("leaves artifacts unstamped when reconciliation is bypassed", async () => {
    const harness = createHarness();

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      plainContext(executionId),
    );

    expect(result.artifacts.every((a) => a.version === undefined)).toBe(true);
  });

  test("behaves identically with no reconciler configured", async () => {
    const harness = createHarness({ withReconciler: false });

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      plainContext(executionId),
    );

    expect(result.success).toBe(true);
    expect(result.artifacts.map((a) => a.id)).toEqual(["figma-json", "ui-ir"]);
  });

  test("skips reconciliation when a planner runs but no reconciler is configured", async () => {
    const harness = createHarness({
      incremental: true,
      withReconciler: false,
    });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    expect(result.success).toBe(true);
    expect(
      harness.events.filter((e) => e.type === "execution.reconciled"),
    ).toHaveLength(0);
  });
});

// ── 9. Reconciliation event emitted ─────────────────────────────

describe("execution.reconciled event", () => {
  test("carries the report counts", async () => {
    const harness = createHarness({ incremental: true });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, incrementalContext(executionId));

    const reconciled = harness.events.filter(
      (e) => e.type === "execution.reconciled",
    );

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.executionId).toBe(executionId);
    expect(reconciled[0]?.payload).toEqual({
      executionId,
      added: 1,
      reused: 1,
      removed: 0,
      unchanged: 0,
    });
  });

  test("is emitted before the execution completes", async () => {
    const harness = createHarness({ incremental: true });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, incrementalContext(executionId));

    const sequence = harness.events.map((e) => e.type);
    const reconciledAt = sequence.indexOf("execution.reconciled");
    const completedAt = sequence.indexOf("execution.completed");

    expect(reconciledAt).toBeGreaterThanOrEqual(0);
    expect(reconciledAt).toBeLessThan(completedAt);
  });

  test("reports removals against the previous run's set", async () => {
    const harness = createHarness({ incremental: true });
    await seedArtifact(harness.artifactStore, "figma-json");
    await seedArtifact(harness.artifactStore, "legacy-css");
    await startExecution(harness.repository, "exec-previous", "completed");

    // The previous run's checkpoint holds an artifact this pipeline no longer
    // produces.
    await harness.repository.saveCheckpoint("exec-previous", {
      executionId: "exec-previous",
      phase: "completed",
      timestamp: Date.now(),
      state: {},
      metadata: {
        appliedArtifacts: [
          { id: "figma-json", type: "test", metadata: {}, version: 1 },
          { id: "legacy-css", type: "test", metadata: {}, version: 1 },
        ],
      },
    });

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, incrementalContext(executionId));

    const reconciled = harness.events.filter(
      (e) => e.type === "execution.reconciled",
    );

    expect(reconciled[0]?.payload?.removed).toBe(1);
  });

  test("emits nothing when reconciliation fails", async () => {
    const harness = createHarness({ incremental: true });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    // A previous set claiming figma-json@1 with different content than the
    // reused reference carries.
    await harness.repository.saveCheckpoint("exec-previous", {
      executionId: "exec-previous",
      phase: "completed",
      timestamp: Date.now(),
      state: {},
      metadata: {
        appliedArtifacts: [
          { id: "ui-ir", type: "test", metadata: { lines: 10 }, version: 1 },
        ],
      },
    });

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    // transform re-emits ui-ir@1 with empty metadata, conflicting with the
    // previous run's record of the same identity.
    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    expect(result.success).toBe(false);
    expect(
      harness.events.filter((e) => e.type === "execution.reconciled"),
    ).toHaveLength(0);
  });
});
