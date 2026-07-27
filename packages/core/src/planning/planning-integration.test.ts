import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
  Capability,
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

/** Records each invocation so a planner-driven skip is observable. */
const counting = (
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

interface Harness {
  readonly engine: ExecutionEngine;
  readonly repository: InMemoryExecutionRepository;
  readonly events: ExecutionEvent[];
  readonly calls: string[];
}

const createHarness = (options?: { readonly withPlanner?: boolean }): Harness => {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher();
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const calls: string[] = [];
  const registry = new CapabilityRegistry();
  registry.register(counting("cap-parse", "figma-json", calls));
  registry.register(counting("cap-transform", "ui-ir", calls));
  registry.register(counting("cap-generate", "generated-code", calls));
  registry.register(counting("cap-validate", "validated-patch", calls));

  const repository = new InMemoryExecutionRepository();

  const planner =
    options?.withPlanner === true
      ? new IncrementalExecutionPlannerService({
          resolveWorkflow: (workflowId) =>
            workflowId === pipeline.id ? pipeline : undefined,
          executionRepository: repository,
        })
      : undefined;

  const engine = new ExecutionEngine(
    registry,
    createLogger(),
    new InMemoryArtifactStore({ eventPublisher }),
    repository,
    eventPublisher,
    undefined,
    undefined,
    planner,
  );

  return { engine, repository, events, calls };
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
