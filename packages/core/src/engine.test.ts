// packages/core/src/engine.test.ts
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ExecutionEngine } from "./engine";
import { CapabilityRegistry } from "./registry";
import { InMemoryExecutionRepository } from "./repository";
import { InMemoryEventPublisher } from "./events";
import {
  type Capability,
  type ArtifactRef,
  type CapabilityPackage,
  type ExecutionRecord,
  type ArtifactStore,
  type Logger,
} from "@designflow/sdk";

// ── Test Helpers ────────────────────────────────────────────────

const passthroughSchema = z.unknown();

const createMockCapability = (id: string): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: passthroughSchema,
  outputSchema: passthroughSchema,
  execute: async (_context, _input) => {
    return { artifactRef: { id: `artifact-${id}`, type: "test" } };
  },
});

const createMockLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

const createMockArtifactStore = (): ArtifactStore => ({
  save: async (_data, _metadata, _lineage) => ({
    id: "test-artifact",
    type: "test",
  }),
  get: async () => null,
  exists: async () => false,
});

const createEngine = (): {
  engine: ExecutionEngine;
  repository: InMemoryExecutionRepository;
  eventPublisher: InMemoryEventPublisher;
} => {
  const registry = new CapabilityRegistry();
  const logger = createMockLogger();
  const artifactStore = createMockArtifactStore();
  const executionRepository = new InMemoryExecutionRepository();
  const eventPublisher = new InMemoryEventPublisher();
  const engine = new ExecutionEngine({
    registry,
    logger,
    artifactStore,
    executionRepository,
    eventPublisher,
  });
  return { engine, repository: executionRepository, eventPublisher };
};

const createExecution = (
  executionId: string,
  workflowId: string,
): {
  runId: string;
  workflowId: string;
  stateRef: string;
  artifacts: never[];
  metadata: Record<string, unknown>;
  signal: AbortSignal;
} => ({
  runId: executionId,
  workflowId,
  stateRef: "test",
  artifacts: [],
  metadata: {},
  signal: new AbortController().signal,
});

const createExecutionRecord = async (
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

// ── Tests ───────────────────────────────────────────────────────

describe("ExecutionEngine with DAG execution", () => {
  test("linear workflow A → B → C executes in order", async () => {
    const executionOrder: string[] = [];
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    const capA: Capability<unknown, unknown> = {
      ...createMockCapability("cap-a"),
      execute: async (_ctx, _input) => {
        executionOrder.push("A");
        return { artifactRef: { id: "artifact-A", type: "test" } };
      },
    };
    const capB: Capability<unknown, unknown> = {
      ...createMockCapability("cap-b"),
      execute: async (_ctx, _input) => {
        executionOrder.push("B");
        return { artifactRef: { id: "artifact-B", type: "test" } };
      },
    };
    const capC: Capability<unknown, unknown> = {
      ...createMockCapability("cap-c"),
      execute: async (_ctx, _input) => {
        executionOrder.push("C");
        return { artifactRef: { id: "artifact-C", type: "test" } };
      },
    };

    registry.register(capA);
    registry.register(capB);
    registry.register(capC);

    const definition = {
      id: "wf-linear",
      name: "linear",
      description: "",
      nodes: [
        { id: "A", capabilityId: "cap-a", inputMap: {} },
        { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
        { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["B"] } },
      ],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-linear");
    const result = await engine.run(definition, createExecution(executionId, "wf-linear"));

    expect(result.success).toBe(true);
    expect(executionOrder).toEqual(["A", "B", "C"]);
    expect(result.completedSteps).toEqual(["A", "B", "C"]);
    expect(result.artifacts).toHaveLength(3);
  });

  test("branch workflow A → {B, C} executes A then B and C", async () => {
    const executionOrder: string[] = [];
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    const capA: Capability<unknown, unknown> = {
      ...createMockCapability("cap-a"),
      execute: async (_ctx, _input) => {
        executionOrder.push("A");
        return { artifactRef: { id: "artifact-A", type: "test" } };
      },
    };
    const capB: Capability<unknown, unknown> = {
      ...createMockCapability("cap-b"),
      execute: async (_ctx, _input) => {
        executionOrder.push("B");
        return { artifactRef: { id: "artifact-B", type: "test" } };
      },
    };
    const capC: Capability<unknown, unknown> = {
      ...createMockCapability("cap-c"),
      execute: async (_ctx, _input) => {
        executionOrder.push("C");
        return { artifactRef: { id: "artifact-C", type: "test" } };
      },
    };

    registry.register(capA);
    registry.register(capB);
    registry.register(capC);

    const definition = {
      id: "wf-branch",
      name: "branch",
      description: "",
      nodes: [
        { id: "A", capabilityId: "cap-a", inputMap: {} },
        { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
        { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["A"] } },
      ],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-branch");
    const result = await engine.run(definition, createExecution(executionId, "wf-branch"));

    expect(result.success).toBe(true);
    expect(executionOrder[0]).toBe("A");
    expect(executionOrder.slice(1).sort()).toEqual(["B", "C"]);
    expect(result.completedSteps).toEqual(["A", "B", "C"]);
    expect(result.artifacts).toHaveLength(3);
  });

  test("merge workflow A,C → D executes A,C then D", async () => {
    const executionOrder: string[] = [];
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    const capA: Capability<unknown, unknown> = {
      ...createMockCapability("cap-a"),
      execute: async (_ctx, _input) => {
        executionOrder.push("A");
        return { artifactRef: { id: "artifact-A", type: "test" } };
      },
    };
    const capC: Capability<unknown, unknown> = {
      ...createMockCapability("cap-c"),
      execute: async (_ctx, _input) => {
        executionOrder.push("C");
        return { artifactRef: { id: "artifact-C", type: "test" } };
      },
    };
    const capD: Capability<unknown, unknown> = {
      ...createMockCapability("cap-d"),
      execute: async (_ctx, _input) => {
        executionOrder.push("D");
        return { artifactRef: { id: "artifact-D", type: "test" } };
      },
    };

    registry.register(capA);
    registry.register(capC);
    registry.register(capD);

    const definition = {
      id: "wf-merge",
      name: "merge",
      description: "",
      nodes: [
        { id: "A", capabilityId: "cap-a", inputMap: {} },
        { id: "C", capabilityId: "cap-c", inputMap: {} },
        {
          id: "D",
          capabilityId: "cap-d",
          inputMap: {},
          execution: { dependsOn: ["A", "C"] },
        },
      ],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-merge");
    const result = await engine.run(definition, createExecution(executionId, "wf-merge"));

    expect(result.success).toBe(true);
    expect(executionOrder.slice(0, 2).sort()).toEqual(["A", "C"]);
    expect(executionOrder[2]).toBe("D");
    expect(result.artifacts).toHaveLength(3);
  });

  test("diamond workflow A → {B,C} → D executes correctly", async () => {
    const executionOrder: string[] = [];
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    const capA: Capability<unknown, unknown> = {
      ...createMockCapability("cap-a"),
      execute: async (_ctx, _input) => {
        executionOrder.push("A");
        return { artifactRef: { id: "artifact-A", type: "test" } };
      },
    };
    const capB: Capability<unknown, unknown> = {
      ...createMockCapability("cap-b"),
      execute: async (_ctx, _input) => {
        executionOrder.push("B");
        return { artifactRef: { id: "artifact-B", type: "test" } };
      },
    };
    const capC: Capability<unknown, unknown> = {
      ...createMockCapability("cap-c"),
      execute: async (_ctx, _input) => {
        executionOrder.push("C");
        return { artifactRef: { id: "artifact-C", type: "test" } };
      },
    };
    const capD: Capability<unknown, unknown> = {
      ...createMockCapability("cap-d"),
      execute: async (_ctx, _input) => {
        executionOrder.push("D");
        return { artifactRef: { id: "artifact-D", type: "test" } };
      },
    };

    registry.register(capA);
    registry.register(capB);
    registry.register(capC);
    registry.register(capD);

    const definition = {
      id: "wf-diamond",
      name: "diamond",
      description: "",
      nodes: [
        { id: "A", capabilityId: "cap-a", inputMap: {} },
        { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
        { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["A"] } },
        {
          id: "D",
          capabilityId: "cap-d",
          inputMap: {},
          execution: { dependsOn: ["B", "C"] },
        },
      ],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-diamond");
    const result = await engine.run(definition, createExecution(executionId, "wf-diamond"));

    expect(result.success).toBe(true);
    expect(executionOrder[0]).toBe("A");
    expect(executionOrder.slice(1, 3).sort()).toEqual(["B", "C"]);
    expect(executionOrder[3]).toBe("D");
    expect(result.artifacts).toHaveLength(4);
  });

  test("cycle rejection throws ExecutionError during compilation", async () => {
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    registry.register(createMockCapability("cap-a"));
    registry.register(createMockCapability("cap-b"));

    const definition = {
      id: "wf-cycle",
      name: "cycle",
      description: "",
      nodes: [
        { id: "A", capabilityId: "cap-a", inputMap: {}, execution: { dependsOn: ["B"] } },
        { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
      ],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-cycle");
    const result = await engine.run(definition, createExecution(executionId, "wf-cycle"));

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("artifacts are collected in deterministic workflow order", async () => {
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    const capA: Capability<unknown, unknown> = {
      ...createMockCapability("cap-a"),
      execute: async (_ctx, _input) => {
        return { artifactRef: { id: "artifact-A", type: "test" } };
      },
    };
    const capB: Capability<unknown, unknown> = {
      ...createMockCapability("cap-b"),
      execute: async (_ctx, _input) => {
        return { artifactRef: { id: "artifact-B", type: "test" } };
      },
    };
    const capC: Capability<unknown, unknown> = {
      ...createMockCapability("cap-c"),
      execute: async (_ctx, _input) => {
        return { artifactRef: { id: "artifact-C", type: "test" } };
      },
    };
    const capD: Capability<unknown, unknown> = {
      ...createMockCapability("cap-d"),
      execute: async (_ctx, _input) => {
        return { artifactRef: { id: "artifact-D", type: "test" } };
      },
    };

    registry.register(capA);
    registry.register(capB);
    registry.register(capC);
    registry.register(capD);

    const definition = {
      id: "wf-deterministic",
      name: "deterministic",
      description: "",
      nodes: [
        { id: "A", capabilityId: "cap-a", inputMap: {} },
        { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
        { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["A"] } },
        {
          id: "D",
          capabilityId: "cap-d",
          inputMap: {},
          execution: { dependsOn: ["B", "C"] },
        },
      ],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-deterministic");
    const result = await engine.run(definition, createExecution(executionId, "wf-deterministic"));

    expect(result.success).toBe(true);
    expect(result.artifacts).toHaveLength(4);
    const refIds = result.artifacts.map((a: ArtifactRef) => a.id);
    expect(refIds).toEqual(["artifact-A", "artifact-B", "artifact-C", "artifact-D"]);
  });

  test("single node executes successfully", async () => {
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    registry.register(createMockCapability("cap-a"));

    const definition = {
      id: "wf-single",
      name: "single",
      description: "",
      nodes: [{ id: "A", capabilityId: "cap-a", inputMap: {} }],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-single");
    const result = await engine.run(definition, createExecution(executionId, "wf-single"));

    expect(result.success).toBe(true);
    expect(result.completedSteps).toEqual(["A"]);
    expect(result.artifacts).toHaveLength(1);
  });

  test("external capability package resolves and executes", async () => {
    const { engine, repository } = createEngine();
    const registry = engine.getRegistry();

    const externalPackage: CapabilityPackage = {
      manifest: {
        id: "external-cap",
        name: "External Capability",
        version: "1.0.0",
        type: "pure",
      },
      capability: {
        id: "external-cap",
        name: "External Capability",
        description: "An external capability package",
        type: "pure",
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        execute: async (_ctx, _input) => {
          return { artifactRef: { id: "external-artifact", type: "external" } };
        },
      },
    };

    registry.registerPackage(externalPackage);

    expect(registry.has("external-cap")).toBe(true);
    expect(registry.getPackage("external-cap")?.manifest).toEqual(externalPackage.manifest);

    const definition = {
      id: "wf-external",
      name: "external",
      description: "",
      nodes: [{ id: "A", capabilityId: "external-cap", inputMap: {} }],
      metadata: {},
    };

    const executionId = crypto.randomUUID();
    await createExecutionRecord(repository, executionId, "wf-external");
    const result = await engine.run(definition, createExecution(executionId, "wf-external"));

    expect(result.success).toBe(true);
    expect(result.completedSteps).toEqual(["A"]);
    expect(result.artifacts).toHaveLength(1);
  });
});

// ── Phase 9: capability agent invocations carry run identity ────

describe("Phase 9 scoped agent invoker", () => {
  test("context.agents.invoke carries executionId and capabilityId as metadata", async () => {
    const captured: Array<Record<string, unknown> | undefined> = [];
    const registry = new CapabilityRegistry();
    const repository = new InMemoryExecutionRepository();
    const engine = new ExecutionEngine({
      registry,
      logger: createMockLogger(),
      artifactStore: createMockArtifactStore(),
      executionRepository: repository,
      eventPublisher: new InMemoryEventPublisher(),
      agentInvoker: {
        invoke: async (request) => {
          captured.push(request.metadata);
          return {
            type: "success",
            agentId: "implementation-agent",
            agentVersion: "0.1.0",
            output: {},
            attempt: request.attempt ?? 1,
          } as never;
        },
      },
    });

    const capability: Capability<unknown, unknown> = {
      ...createMockCapability("cap-agent"),
      execute: async (context, _input) => {
        await context.agents!.invoke({
          agentId: "implementation-agent",
          objective: "test",
          input: {},
          attempt: 1,
        });
        // A caller-supplied value must win over the injected identity.
        await context.agents!.invoke({
          agentId: "implementation-agent",
          objective: "test",
          input: {},
          attempt: 2,
          metadata: { capabilityId: "caller-override" },
        });
        return { artifactRef: { id: "artifact-agent", type: "test" } };
      },
    };
    engine.getRegistry().register(capability);

    const executionId = crypto.randomUUID();
    await repository.create({ executionId, workflowId: "wf-agent", status: "running", startedAt: Date.now() });

    const definition = {
      id: "wf-agent",
      name: "agent",
      description: "",
      nodes: [{ id: "A", capabilityId: "cap-agent", inputMap: {} }],
      metadata: {},
    };
    const result = await engine.run(definition, createExecution(executionId, "wf-agent"));

    expect(result.success).toBe(true);
    expect(captured.length).toBe(2);
    expect(captured[0]).toMatchObject({ executionId, capabilityId: "cap-agent" });
    expect(captured[1]).toMatchObject({ executionId, capabilityId: "caller-override" });
  });
});
