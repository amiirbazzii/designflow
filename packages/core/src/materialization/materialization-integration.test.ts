// packages/core/src/materialization/materialization-integration.test.ts
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  type ArtifactMaterializer,
  type Capability,
  type CapabilityReuseDecision,
  type CapabilityReuseRequest,
  type CapabilityReuseResolver,
  type ExecutionContext,
  type ExecutionEvent,
  type ExecutionRecord,
  type Logger,
  type WorkflowDefinition,
  withChangedArtifacts,
  workflowDefinitionSchema,
} from "@designflow/sdk";

import { ExecutionEngine } from "../engine";
import { CapabilityRegistry } from "../registry";
import { InMemoryExecutionRepository } from "../repository";
import { InMemoryEventPublisher } from "../events";
import { InMemoryArtifactStore } from "../artifacts";
import { IncrementalExecutionPlannerService } from "../planning";
import { RegistryArtifactMaterializer } from "./materializer";

// ── Fixtures ────────────────────────────────────────────────────

const createLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

/** parse -> transform -> generate. Only parse is upstream of a ui-ir change. */
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
    {
      id: "generate",
      capabilityId: "cap-generate",
      produces: ["generated-code"],
      execution: { dependsOn: ["transform"] },
    },
  ],
});

/** Records invocations and the parent artifacts each node was handed. */
const recording = (
  id: string,
  artifactId: string,
  calls: string[],
  parentsSeen: Map<string, readonly string[]>,
): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async (ctx) => {
    calls.push(id);
    parentsSeen.set(id, ctx.parentArtifacts.map((a) => a.id));
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

/** Grants reuse of `figma-json` for the parse node only. */
const reuseParse = (artifactId = "figma-json"): ScriptedReuseResolver =>
  new ScriptedReuseResolver((request) =>
    request.nodeId === "parse"
      ? {
          reuse: true,
          artifacts: [{ id: artifactId, type: "test", metadata: {} }],
          reason: "unchanged upstream",
        }
      : { reuse: false, artifacts: [] },
  );

interface Harness {
  readonly engine: ExecutionEngine;
  readonly repository: InMemoryExecutionRepository;
  readonly artifactStore: InMemoryArtifactStore;
  readonly events: ExecutionEvent[];
  readonly calls: string[];
  readonly parentsSeen: Map<string, readonly string[]>;
}

const createHarness = (options?: {
  readonly reuseResolver?: CapabilityReuseResolver;
  readonly withMaterializer?: boolean;
  readonly materializer?: ArtifactMaterializer;
}): Harness => {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher();
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const calls: string[] = [];
  const parentsSeen = new Map<string, readonly string[]>();
  const registry = new CapabilityRegistry();
  registry.register(recording("cap-parse", "figma-json", calls, parentsSeen));
  registry.register(recording("cap-transform", "ui-ir", calls, parentsSeen));
  registry.register(
    recording("cap-generate", "generated-code", calls, parentsSeen),
  );

  const repository = new InMemoryExecutionRepository();
  const artifactStore = new InMemoryArtifactStore({ eventPublisher });

  const planner = new IncrementalExecutionPlannerService({
    resolveWorkflow: (workflowId) =>
      workflowId === pipeline.id ? pipeline : undefined,
    executionRepository: repository,
  });

  const materializer =
    options?.materializer ??
    (options?.withMaterializer === true
      ? new RegistryArtifactMaterializer({
          registry: artifactStore,
          eventPublisher,
        })
      : undefined);

  const engine = new ExecutionEngine({
    registry,
    logger: createLogger(),
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    incrementalPlanner: planner,
    reuseResolver: options?.reuseResolver,
    artifactMaterializer: materializer,
  });

  return { engine, repository, artifactStore, events, calls, parentsSeen };
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

const incrementalContext = (executionId: string): ExecutionContext => ({
  runId: executionId,
  workflowId: pipeline.id,
  stateRef: "test",
  artifacts: [],
  metadata: {
    ...withChangedArtifacts({}, ["ui-ir"]),
    previousExecutionId: "exec-previous",
  },
  signal: new AbortController().signal,
});

/** Runs the pipeline with parse planned-skipped, returning the harness. */
const runIncremental = async (
  harness: Harness,
): Promise<Awaited<ReturnType<ExecutionEngine["run"]>>> => {
  await startExecution(harness.repository, "exec-previous", "completed");
  const executionId = crypto.randomUUID();
  await startExecution(harness.repository, executionId);
  return harness.engine.run(pipeline, incrementalContext(executionId));
};

// ── 5. Planner + resolver + materializer integration ────────────

describe("planner, resolver and materializer composed", () => {
  test("skips the node and injects materialized artifacts", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse(),
      withMaterializer: true,
    });
    await seedArtifact(harness.artifactStore, "figma-json");

    const result = await runIncremental(harness);

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual(["cap-transform", "cap-generate"]);
    expect(result.completedSteps).toEqual(["parse", "transform", "generate"]);
    expect(result.artifacts.map((a) => a.id)).toEqual([
      "figma-json",
      "ui-ir",
      "generated-code",
    ]);
  });

  test("emits materialized before reused for the skipped node", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse(),
      withMaterializer: true,
    });
    await seedArtifact(harness.artifactStore, "figma-json");

    await runIncremental(harness);

    const sequence = harness.events
      .filter(
        (e) =>
          e.type === "artifact.materialized" || e.type === "artifact.reused",
      )
      .map((e) => e.type);

    // Validation precedes adoption: nothing is announced as reused until it
    // has been proven usable.
    expect(sequence).toEqual(["artifact.materialized", "artifact.reused"]);
  });

  test("materialized event carries the originating execution", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse(),
      withMaterializer: true,
    });
    await seedArtifact(harness.artifactStore, "figma-json");

    await runIncremental(harness);

    const materialized = harness.events.filter(
      (e) => e.type === "artifact.materialized",
    );

    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.payload).toEqual({
      nodeId: "parse",
      artifactId: "figma-json",
      sourceExecutionId: "exec-previous",
    });
  });

  test("rebuilds the reference from the registry, not the resolver's claim", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse(),
      withMaterializer: true,
    });

    // Registered with a different type than the resolver claims.
    await harness.artifactStore.createArtifact({
      id: "figma-json",
      type: "figma.json",
      metadata: { source: "registry" },
      provenance: {
        executionId: "exec-previous",
        workflowId: pipeline.id,
        capabilityId: "cap-parse",
      },
    });

    const result = await runIncremental(harness);

    const injected = result.artifacts.find((a) => a.id === "figma-json");
    expect(injected?.type).toBe("figma.json");
    expect(injected?.metadata).toEqual({ source: "registry" });
  });
});

// ── 6. Materialized artifact reaches downstream node ────────────

describe("downstream visibility", () => {
  test("hands the materialized artifact to the dependent node", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse(),
      withMaterializer: true,
    });
    await seedArtifact(harness.artifactStore, "figma-json");

    await runIncremental(harness);

    expect(harness.parentsSeen.get("cap-transform")).toEqual(["figma-json"]);
  });

  test("propagates it further down the chain", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse(),
      withMaterializer: true,
    });
    await seedArtifact(harness.artifactStore, "figma-json");

    await runIncremental(harness);

    expect(harness.parentsSeen.get("cap-generate")).toEqual([
      "figma-json",
      "ui-ir",
    ]);
  });
});

// ── 7. Failed materialization blocks dependents ─────────────────

describe("failed materialization", () => {
  test("fails the node when the artifact was never registered", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse("never-registered"),
      withMaterializer: true,
    });

    const result = await runIncremental(harness);

    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("parse");
  });

  test("blocks dependents rather than running them without the artifact", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse("never-registered"),
      withMaterializer: true,
    });

    await runIncremental(harness);

    // transform depends on parse, so it must not run at all.
    expect(harness.calls).toEqual([]);
  });

  test("emits neither materialized nor reused on failure", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse("never-registered"),
      withMaterializer: true,
    });

    await runIncremental(harness);

    expect(
      harness.events.filter(
        (e) =>
          e.type === "artifact.materialized" || e.type === "artifact.reused",
      ),
    ).toHaveLength(0);
  });

  test("treats a success:false result as a failure", async () => {
    const declining: ArtifactMaterializer = {
      materialize: async () => ({ success: false, artifacts: [] }),
    };

    const harness = createHarness({
      reuseResolver: reuseParse(),
      materializer: declining,
    });
    await seedArtifact(harness.artifactStore, "figma-json");

    const result = await runIncremental(harness);

    // The contract allows a soft failure as well as a thrown error.
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("parse");
    expect(harness.calls).toEqual([]);
  });
});

// ── 8. Resolver false executes capability ───────────────────────

describe("resolver declines", () => {
  test("runs the node normally", async () => {
    const declining = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness({
      reuseResolver: declining,
      withMaterializer: true,
    });

    const result = await runIncremental(harness);

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual([
      "cap-parse",
      "cap-transform",
      "cap-generate",
    ]);
  });

  test("never consults the materializer", async () => {
    let materializeCalls = 0;
    const counting: ArtifactMaterializer = {
      materialize: async () => {
        materializeCalls++;
        return { success: true, artifacts: [] };
      },
    };

    const declining = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness({
      reuseResolver: declining,
      materializer: counting,
    });

    await runIncremental(harness);

    // "Can we reuse?" is answered before "are these artifacts usable?".
    expect(materializeCalls).toBe(0);
  });
});

// ── 9. No materializer preserves compatibility ──────────────────

describe("no materializer configured", () => {
  test("still adopts a valid reuse decision", async () => {
    const harness = createHarness({ reuseResolver: reuseParse() });
    await seedArtifact(harness.artifactStore, "figma-json");

    const result = await runIncremental(harness);

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual(["cap-transform", "cap-generate"]);
    expect(harness.parentsSeen.get("cap-transform")).toEqual(["figma-json"]);
  });

  test("keeps the engine's own existence check", async () => {
    const harness = createHarness({
      reuseResolver: reuseParse("never-registered"),
    });

    const result = await runIncremental(harness);

    // Integrity is not given up just because no materializer was supplied.
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("parse");
  });

  test("emits reused but not materialized", async () => {
    const harness = createHarness({ reuseResolver: reuseParse() });
    await seedArtifact(harness.artifactStore, "figma-json");

    await runIncremental(harness);

    expect(
      harness.events.filter((e) => e.type === "artifact.reused"),
    ).toHaveLength(1);
    expect(
      harness.events.filter((e) => e.type === "artifact.materialized"),
    ).toHaveLength(0);
  });

  test("adopts the resolver's reference verbatim", async () => {
    const harness = createHarness({ reuseResolver: reuseParse() });

    // Registered with a different type; without a materializer the engine only
    // checks existence and injects what the resolver claimed.
    await harness.artifactStore.createArtifact({
      id: "figma-json",
      type: "figma.json",
      metadata: { source: "registry" },
      provenance: {
        executionId: "exec-previous",
        workflowId: pipeline.id,
        capabilityId: "cap-parse",
      },
    });

    const result = await runIncremental(harness);

    const injected = result.artifacts.find((a) => a.id === "figma-json");
    expect(injected?.type).toBe("test");
  });
});
