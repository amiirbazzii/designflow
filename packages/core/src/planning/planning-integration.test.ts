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
import { IncrementalExecutionPlannerService } from "./planner";

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
    {
      id: "generate",
      capabilityId: "cap-generate",
      produces: ["generated-code"],
      execution: { dependsOn: ["transform"] },
    },
    {
      id: "validate",
      capabilityId: "cap-validate",
      produces: ["validated-patch"],
      execution: { dependsOn: ["generate"] },
    },
  ],
});

/** Records the parent artifacts each node was handed when it ran. */
const recordingParents = (
  id: string,
  artifactId: string,
  calls: string[],
  seen: Map<string, readonly string[]>,
): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async (ctx) => {
    calls.push(id);
    seen.set(id, ctx.parentArtifacts.map((artifact) => artifact.id));
    return { artifactRef: { id: artifactId, type: "test", metadata: {} } };
  },
});

interface Harness {
  readonly engine: ExecutionEngine;
  readonly repository: InMemoryExecutionRepository;
  readonly artifactStore: InMemoryArtifactStore;
  readonly events: ExecutionEvent[];
  readonly calls: string[];
  readonly parentsSeen: Map<string, readonly string[]>;
}

const createHarness = (options?: {
  readonly withPlanner?: boolean;
  readonly reuseResolver?: CapabilityReuseResolver;
}): Harness => {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher();
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const calls: string[] = [];
  const parentsSeen = new Map<string, readonly string[]>();
  const registry = new CapabilityRegistry();
  registry.register(
    recordingParents("cap-parse", "figma-json", calls, parentsSeen),
  );
  registry.register(
    recordingParents("cap-transform", "ui-ir", calls, parentsSeen),
  );
  registry.register(
    recordingParents("cap-generate", "generated-code", calls, parentsSeen),
  );
  registry.register(
    recordingParents("cap-validate", "validated-patch", calls, parentsSeen),
  );

  const repository = new InMemoryExecutionRepository();
  const artifactStore = new InMemoryArtifactStore({ eventPublisher });

  const planner =
    options?.withPlanner === true
      ? new IncrementalExecutionPlannerService({
          resolveWorkflow: (workflowId) =>
            workflowId === pipeline.id ? pipeline : undefined,
          executionRepository: repository,
        })
      : undefined;

  const engine = new ExecutionEngine({
    registry,
    logger: createLogger(),
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    incrementalPlanner: planner,
    reuseResolver: options?.reuseResolver,
  });

  return { engine, repository, artifactStore, events, calls, parentsSeen };
};

const createContext = (
  executionId: string,
  metadata: Record<string, unknown> = {},
): ExecutionContext => ({
  runId: executionId,
  workflowId: pipeline.id,
  stateRef: "test",
  artifacts: [],
  metadata,
  signal: new AbortController().signal,
});

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

// ── 9. Planner disabled keeps old behaviour ─────────────────────

describe("planner disabled", () => {
  test("runs every node when no planner is configured", async () => {
    const harness = createHarness();

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      createContext(executionId),
    );

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual([
      "cap-parse",
      "cap-transform",
      "cap-generate",
      "cap-validate",
    ]);
    expect(result.completedSteps).toHaveLength(4);
  });

  test("emits no plan_created event without a planner", async () => {
    const harness = createHarness();

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, createContext(executionId));

    expect(
      harness.events.filter((e) => e.type === "execution.plan_created"),
    ).toHaveLength(0);
  });

  test("ignores a change set when no planner is configured", async () => {
    const harness = createHarness();

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(
      pipeline,
      createContext(executionId, withChangedArtifacts({}, ["ui-ir"])),
    );

    expect(harness.calls).toHaveLength(4);
  });
});

// ── Planner-driven execution ────────────────────────────────────

describe("planner enabled", () => {
  test("runs everything on a first execution", async () => {
    const harness = createHarness({ withPlanner: true });

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      createContext(executionId, withChangedArtifacts({}, ["ui-ir"])),
    );

    // No previous execution is referenced, so nothing is reusable.
    expect(result.success).toBe(true);
    expect(harness.calls).toHaveLength(4);
  });

  test("skips unaffected nodes when a previous execution is referenced", async () => {
    const harness = createHarness({ withPlanner: true });

    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      createContext(executionId, {
        ...withChangedArtifacts({}, ["ui-ir"]),
        previousExecutionId: "exec-previous",
      }),
    );

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual([
      "cap-transform",
      "cap-generate",
      "cap-validate",
    ]);
    expect(result.completedSteps).toEqual([
      "transform",
      "generate",
      "validate",
    ]);
  });

  test("a skipped node does not block its dependents", async () => {
    const harness = createHarness({ withPlanner: true });

    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      createContext(executionId, {
        ...withChangedArtifacts({}, ["ui-ir"]),
        previousExecutionId: "exec-previous",
      }),
    );

    // transform depends on the skipped parse node and must still run.
    expect(result.failedStep).toBeUndefined();
    expect(harness.calls).toContain("cap-transform");
  });

  test("skips the whole workflow for an empty change set", async () => {
    const harness = createHarness({ withPlanner: true });

    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      createContext(executionId, { previousExecutionId: "exec-previous" }),
    );

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual([]);
    expect(result.artifacts).toEqual([]);
  });

  test("runs everything when the root artifact changes", async () => {
    const harness = createHarness({ withPlanner: true });

    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    await harness.engine.run(
      pipeline,
      createContext(executionId, {
        ...withChangedArtifacts({}, ["figma-json"]),
        previousExecutionId: "exec-previous",
      }),
    );

    expect(harness.calls).toHaveLength(4);
  });

  test("a skipped node contributes no artifacts", async () => {
    const harness = createHarness({ withPlanner: true });

    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      createContext(executionId, {
        ...withChangedArtifacts({}, ["ui-ir"]),
        previousExecutionId: "exec-previous",
      }),
    );

    // Adopting a skipped node's prior output is a reuse-resolver concern; the
    // planner only decides what to leave out.
    expect(result.artifacts.map((a) => a.id)).toEqual([
      "ui-ir",
      "generated-code",
      "validated-patch",
    ]);
  });
});

// ── 10. plan_created event ──────────────────────────────────────

describe("execution.plan_created event", () => {
  test("is emitted with the plan's classification", async () => {
    const harness = createHarness({ withPlanner: true });

    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    await harness.engine.run(
      pipeline,
      createContext(executionId, {
        ...withChangedArtifacts({}, ["ui-ir"]),
        previousExecutionId: "exec-previous",
      }),
    );

    const planned = harness.events.filter(
      (e) => e.type === "execution.plan_created",
    );

    expect(planned).toHaveLength(1);
    expect(planned[0]?.executionId).toBe(executionId);
    expect(planned[0]?.payload).toEqual({
      workflowId: "design-to-code",
      affectedNodes: ["transform", "generate", "validate"],
      skippedNodes: ["parse"],
      executionNodes: ["transform", "generate", "validate"],
    });
  });

  test("is emitted before execution begins", async () => {
    const harness = createHarness({ withPlanner: true });

    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    await harness.engine.run(
      pipeline,
      createContext(executionId, {
        ...withChangedArtifacts({}, ["ui-ir"]),
        previousExecutionId: "exec-previous",
      }),
    );

    const sequence = harness.events.map((e) => e.type);
    const planIndex = sequence.indexOf("execution.plan_created");
    const executingIndex = sequence.indexOf("execution.executing");

    expect(planIndex).toBeGreaterThanOrEqual(0);
    expect(planIndex).toBeLessThan(executingIndex);
  });

  test("is emitted even when nothing is skipped", async () => {
    const harness = createHarness({ withPlanner: true });

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    await harness.engine.run(
      pipeline,
      createContext(executionId, withChangedArtifacts({}, ["figma-json"])),
    );

    const planned = harness.events.filter(
      (e) => e.type === "execution.plan_created",
    );

    expect(planned).toHaveLength(1);
    expect(planned[0]?.payload?.skippedNodes).toEqual([]);
  });

  test("fails the run when the planner cannot resolve the workflow", async () => {
    const harness = createHarness({ withPlanner: true });

    const orphan = workflowDefinitionSchema.parse({
      id: "wf-unknown",
      name: "unknown",
      nodes: [{ id: "parse", capabilityId: "cap-parse" }],
    });

    const executionId = crypto.randomUUID();
    await harness.repository.create({
      executionId,
      workflowId: orphan.id,
      status: "running",
      startedAt: Date.now(),
    });

    const result = await harness.engine.run(orphan, {
      runId: executionId,
      workflowId: orphan.id,
      stateRef: "test",
      artifacts: [],
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result.success).toBe(false);
    expect(harness.calls).toEqual([]);
  });
});

// ── Planner + reuse resolver composition ────────────────────────

/** Answers reuse from a script, recording what it was asked. */
class ScriptedReuseResolver implements CapabilityReuseResolver {
  public readonly requests: CapabilityReuseRequest[] = [];

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
    this.requests.push(request);
    return this.decide(request);
  }
}

/** Registers an artifact as if the previous execution had produced it. */
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

const incrementalContext = (executionId: string): ExecutionContext =>
  createContext(executionId, {
    ...withChangedArtifacts({}, ["ui-ir"]),
    previousExecutionId: "exec-previous",
  });

describe("planner and reuse resolver composed", () => {
  test("recovers a skipped node's artifacts through the resolver", async () => {
    const resolver = new ScriptedReuseResolver((request) =>
      request.nodeId === "parse"
        ? {
            reuse: true,
            artifacts: [{ id: "figma-json", type: "test", metadata: {} }],
            reason: "unchanged upstream",
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness({ withPlanner: true, reuseResolver: resolver });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    expect(result.success).toBe(true);
    expect(harness.calls).toEqual([
      "cap-transform",
      "cap-generate",
      "cap-validate",
    ]);

    // The gap Stage 24 documented: the skipped node's artifact is now present.
    expect(result.artifacts.map((a) => a.id)).toEqual([
      "figma-json",
      "ui-ir",
      "generated-code",
      "validated-patch",
    ]);
  });

  test("hands the recovered artifact to the downstream node", async () => {
    const resolver = new ScriptedReuseResolver((request) =>
      request.nodeId === "parse"
        ? {
            reuse: true,
            artifacts: [{ id: "figma-json", type: "test", metadata: {} }],
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness({ withPlanner: true, reuseResolver: resolver });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, incrementalContext(executionId));

    // transform depends on the skipped parse node and must still see its
    // output — this is the whole point of the composition.
    expect(harness.parentsSeen.get("cap-transform")).toEqual(["figma-json"]);
  });

  test("counts a recovered node as completed", async () => {
    const resolver = new ScriptedReuseResolver((request) =>
      request.nodeId === "parse"
        ? {
            reuse: true,
            artifacts: [{ id: "figma-json", type: "test", metadata: {} }],
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness({ withPlanner: true, reuseResolver: resolver });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    expect(result.completedSteps).toEqual([
      "parse",
      "transform",
      "generate",
      "validate",
    ]);
  });

  test("emits artifact.reused for the skipped node", async () => {
    const resolver = new ScriptedReuseResolver((request) =>
      request.nodeId === "parse"
        ? {
            reuse: true,
            artifacts: [{ id: "figma-json", type: "test", metadata: {} }],
            reason: "unchanged upstream",
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness({ withPlanner: true, reuseResolver: resolver });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, incrementalContext(executionId));

    const reused = harness.events.filter((e) => e.type === "artifact.reused");

    expect(reused).toHaveLength(1);
    expect(reused[0]?.payload?.artifactId).toBe("figma-json");
    expect(reused[0]?.payload?.nodeId).toBe("parse");
    expect(reused[0]?.payload?.reason).toBe("unchanged upstream");
  });

  test("asks the resolver only about the planner-skipped node", async () => {
    const resolver = new ScriptedReuseResolver((request) =>
      request.nodeId === "parse"
        ? {
            reuse: true,
            artifacts: [{ id: "figma-json", type: "test", metadata: {} }],
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness({ withPlanner: true, reuseResolver: resolver });
    await seedArtifact(harness.artifactStore, "figma-json");
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);
    await harness.engine.run(pipeline, incrementalContext(executionId));

    // Nodes the planner kept are still offered to the resolver by the
    // per-capability boundary, but the skipped node must be among them.
    expect(resolver.requests.map((r) => r.nodeId)).toContain("parse");
    const parse = resolver.requests.find((r) => r.nodeId === "parse");
    expect(parse?.capabilityId).toBe("cap-parse");
    expect(parse?.inputFingerprint.length).toBe(64);
  });

  test("runs the node when the resolver cannot supply its output", async () => {
    const resolver = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness({ withPlanner: true, reuseResolver: resolver });
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    // The optimisation degrades to correctness rather than dropping outputs.
    expect(result.success).toBe(true);
    expect(harness.calls).toEqual([
      "cap-parse",
      "cap-transform",
      "cap-generate",
      "cap-validate",
    ]);
    expect(result.artifacts).toHaveLength(4);
  });

  test("fails the node when the resolver adopts an unregistered artifact", async () => {
    const resolver = new ScriptedReuseResolver((request) =>
      request.nodeId === "parse"
        ? {
            reuse: true,
            artifacts: [{ id: "never-registered", type: "test", metadata: {} }],
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness({ withPlanner: true, reuseResolver: resolver });
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    // Stage 23's integrity check still governs what may be adopted.
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("parse");
  });

  test("keeps the artifact-less skip when no resolver is configured", async () => {
    const harness = createHarness({ withPlanner: true });
    await startExecution(harness.repository, "exec-previous", "completed");

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId);

    const result = await harness.engine.run(
      pipeline,
      incrementalContext(executionId),
    );

    // Behaviour for a host running the planner alone is unchanged.
    expect(result.success).toBe(true);
    expect(harness.calls).toEqual([
      "cap-transform",
      "cap-generate",
      "cap-validate",
    ]);
    expect(result.completedSteps).toEqual([
      "transform",
      "generate",
      "validate",
    ]);
    expect(harness.parentsSeen.get("cap-transform")).toEqual([]);
  });
});
