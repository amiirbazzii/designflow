import { describe, expect, test, beforeEach } from "bun:test";
import { z } from "zod";
import { ExecutionEngine } from "../engine";
import { CapabilityRegistry } from "../registry";
import { InMemoryExecutionRepository } from "../repository";
import { InMemoryEventPublisher } from "../events";
import { InMemoryApprovalManager } from "../approval";
import { ExecutionService } from "../service";
import type { WorkflowResolver } from "../service";
import { WorkflowCompositionExecutor } from "./workflow-composition-executor";
import { WorkflowCompositionCycleError } from "../errors";
import { DesignFlowError } from "@designflow/sdk";
import {
  readCompositionCheckpoint,
  readExecutionInput,
  readExecutionLineage,
} from "@designflow/sdk";
import type {
  ArtifactRef,
  ArtifactStore,
  Capability,
  ExecutionContext,
  ExecutionEvent,
  ExecutionPolicy,
  ExecutionRecord,
  Logger,
  PolicyContext,
  PolicyEvaluationResult,
  PolicyEvaluator,
  WorkflowDefinition,
  WorkflowExecutionResolver,
  WorkflowInvocation,
  WorkflowInvocationContext,
  WorkflowInvocationResult,
  WorkflowPackage,
} from "@designflow/sdk";

// ── Test Helpers ────────────────────────────────────────────────

const passthroughSchema = z.unknown();

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

const createCapability = (
  id: string,
  execute?: Capability<unknown, unknown>["execute"],
): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: passthroughSchema,
  outputSchema: passthroughSchema,
  execute:
    execute ??
    (async () => ({ artifactRef: { id: `artifact-${id}`, type: "test" } })),
});

const createExecutionContext = (
  executionId: string,
  workflowId: string,
  metadata: Record<string, unknown> = {},
): ExecutionContext => ({
  runId: executionId,
  workflowId,
  stateRef: "test",
  artifacts: [],
  metadata,
  signal: new AbortController().signal,
});

const createRecord = async (
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

/** Records every invocation and returns a scripted result. */
class StubWorkflowExecutionResolver implements WorkflowExecutionResolver {
  public readonly invocations: {
    invocation: WorkflowInvocation;
    context: WorkflowInvocationContext;
  }[] = [];

  private readonly respond: (
    invocation: WorkflowInvocation,
  ) => WorkflowInvocationResult;

  public constructor(
    respond: (invocation: WorkflowInvocation) => WorkflowInvocationResult,
  ) {
    this.respond = respond;
  }

  public async executeWorkflow(
    invocation: WorkflowInvocation,
    context: WorkflowInvocationContext,
  ): Promise<WorkflowInvocationResult> {
    this.invocations.push({ invocation, context });
    return this.respond(invocation);
  }
}

/** Pulls one failed node's error metadata out of an aggregate run failure. */
const nodeFailureMetadata = (
  error: unknown,
  nodeId: string,
): Record<string, unknown> => {
  if (!(error instanceof DesignFlowError)) {
    throw new Error("expected a DesignFlowError");
  }

  const failedErrors = z
    .record(z.string(), z.unknown())
    .parse(error.metadata.failedErrors);

  const nodeError = failedErrors[nodeId];
  if (!(nodeError instanceof DesignFlowError)) {
    throw new Error(`expected a DesignFlowError for node ${nodeId}`);
  }

  return nodeError.metadata;
};

const createWorkflowPackage = (
  definition: WorkflowDefinition,
): WorkflowPackage => ({
  id: definition.id,
  name: definition.name,
  version: "1.0.0",
  definition,
  load: () => {},
});

// ── Engine-level composition ────────────────────────────────────

describe("ExecutionEngine workflow composition", () => {
  let logger: Logger;
  let artifactStore: ArtifactStore;
  let repository: InMemoryExecutionRepository;
  let eventPublisher: InMemoryEventPublisher;
  let registry: CapabilityRegistry;
  let events: ExecutionEvent[];

  beforeEach(() => {
    logger = createMockLogger();
    artifactStore = createMockArtifactStore();
    repository = new InMemoryExecutionRepository();
    eventPublisher = new InMemoryEventPublisher();
    registry = new CapabilityRegistry();
    events = [];
    eventPublisher.subscribe((event) => {
      events.push(event);
    });
  });

  const createEngine = (
    resolver?: WorkflowExecutionResolver,
  ): ExecutionEngine =>
    new ExecutionEngine(
      registry,
      logger,
      artifactStore,
      repository,
      eventPublisher,
      resolver,
    );

  test("parent executes a child workflow successfully", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => ({
      executionId: "child-exec-1",
      workflowId: "wf-child",
      status: "completed",
      artifacts: [{ id: "child-artifact", type: "test", metadata: {} }],
    }));

    const engine = createEngine(resolver);

    const definition: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: { seed: 7 },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-parent");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-parent"),
    );

    expect(result.success).toBe(true);
    expect(result.completedSteps).toEqual(["child"]);
    expect(result.pendingApproval).toBeUndefined();

    expect(resolver.invocations).toHaveLength(1);
    const [first] = resolver.invocations;
    expect(first?.invocation.workflowId).toBe("wf-child");
    expect(first?.invocation.input).toEqual({ seed: 7 });
    expect(first?.context.parentExecutionId).toBe(executionId);
    expect(first?.context.parentWorkflowId).toBe("wf-parent");
    expect(first?.context.parentNodeId).toBe("child");
  });

  test("child artifacts are returned to the parent DAG", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => ({
      executionId: "child-exec-1",
      workflowId: "wf-child",
      status: "completed",
      artifacts: [
        { id: "child-artifact-a", type: "test", metadata: {} },
        { id: "child-artifact-b", type: "test", metadata: {} },
      ],
    }));

    const seenByDownstream: string[] = [];
    registry.register(
      createCapability("cap-downstream", async (ctx) => {
        for (const artifact of ctx.parentArtifacts) {
          seenByDownstream.push(artifact.id);
        }
        return { artifactRef: { id: "downstream-artifact", type: "test" } };
      }),
    );

    const engine = createEngine(resolver);

    const definition: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: {},
          next: [],
        },
        {
          id: "downstream",
          capabilityId: "cap-downstream",
          inputMap: {},
          execution: { dependsOn: ["child"] },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-parent");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-parent"),
    );

    expect(result.success).toBe(true);
    expect(result.artifacts.map((a: ArtifactRef) => a.id)).toEqual([
      "child-artifact-a",
      "child-artifact-b",
      "downstream-artifact",
    ]);
    expect(seenByDownstream).toEqual([
      "child-artifact-a",
      "child-artifact-b",
    ]);
  });

  test("child failure fails the parent node and blocks dependents", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => ({
      executionId: "child-exec-1",
      workflowId: "wf-child",
      status: "failed",
      artifacts: [{ id: "partial-child-artifact", type: "test", metadata: {} }],
      error: { code: "ERR_CHILD_BOOM", message: "child blew up" },
    }));

    let downstreamRan = false;
    registry.register(
      createCapability("cap-downstream", async () => {
        downstreamRan = true;
        return { artifactRef: { id: "downstream-artifact", type: "test" } };
      }),
    );

    const engine = createEngine(resolver);

    const definition: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: {},
          next: [],
        },
        {
          id: "downstream",
          capabilityId: "cap-downstream",
          inputMap: {},
          execution: { dependsOn: ["child"] },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-parent");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-parent"),
    );

    expect(result.success).toBe(false);
    expect(result.failedStep).toBe("child");
    expect(downstreamRan).toBe(false);
    expect(result.completedSteps).not.toContain("downstream");

    // Artifacts the child already produced stay traceable on the failure.
    expect(result.error).toBeInstanceOf(DesignFlowError);

    const childMetadata = nodeFailureMetadata(result.error, "child");
    expect(childMetadata.childArtifacts).toEqual(["partial-child-artifact"]);
    expect(childMetadata.childExecutionId).toBe("child-exec-1");
    expect(childMetadata.childError).toEqual({
      code: "ERR_CHILD_BOOM",
      message: "child blew up",
    });
  });

  test("child pending approval blocks the parent without failing it", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => ({
      executionId: "child-exec-1",
      workflowId: "wf-child",
      status: "pending_approval",
      artifacts: [],
      error: {
        code: "ERR_APPROVAL_REQUIRED",
        message: "Approval required: deploy gate",
      },
    }));

    let downstreamRan = false;
    registry.register(
      createCapability("cap-downstream", async () => {
        downstreamRan = true;
        return { artifactRef: { id: "downstream-artifact", type: "test" } };
      }),
    );

    const engine = createEngine(resolver);

    const definition: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: {},
          next: [],
        },
        {
          id: "downstream",
          capabilityId: "cap-downstream",
          inputMap: {},
          execution: { dependsOn: ["child"] },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-parent");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-parent"),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.failedStep).toBeUndefined();
    expect(result.completedSteps).not.toContain("child");
    expect(downstreamRan).toBe(false);

    expect(result.pendingApproval).toEqual({
      nodeId: "child",
      childWorkflowId: "wf-child",
      childExecutionId: "child-exec-1",
      childArtifacts: [],
      message: "Approval required: deploy gate",
    });

    const checkpoint = await repository.getLatestCheckpoint(executionId);
    expect(checkpoint?.phase).toBe("waiting_approval");
  });

  test("direct cycle A -> A is rejected", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => {
      throw new Error("resolver must not be reached for a cycle");
    });

    const engine = createEngine(resolver);

    const definition: WorkflowDefinition = {
      id: "wf-a",
      name: "a",
      description: "",
      nodes: [
        {
          id: "self",
          kind: "workflow",
          workflowId: "wf-a",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-a");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-a"),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(WorkflowCompositionCycleError);
    const error = result.error as WorkflowCompositionCycleError;
    expect(error.code).toBe("ERR_WORKFLOW_COMPOSITION_CYCLE");
    expect(error.compositionPath).toEqual(["wf-a", "wf-a"]);
    expect(resolver.invocations).toHaveLength(0);
  });

  test("indirect cycle A -> B -> A is rejected", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => {
      throw new Error("resolver must not be reached for a cycle");
    });

    const engine = createEngine(resolver);

    // wf-b executing as a child of wf-a: the inherited composition path
    // already contains wf-a, so invoking wf-a again is a cycle.
    const definition: WorkflowDefinition = {
      id: "wf-b",
      name: "b",
      description: "",
      nodes: [
        {
          id: "back-to-a",
          kind: "workflow",
          workflowId: "wf-a",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-b");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-b", {
        lineage: {
          parentExecutionId: "exec-a",
          parentWorkflowId: "wf-a",
          parentNodeId: "node-a",
          compositionPath: ["wf-a", "wf-b"],
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(WorkflowCompositionCycleError);
    expect((result.error as WorkflowCompositionCycleError).compositionPath).toEqual([
      "wf-a",
      "wf-b",
      "wf-a",
    ]);
    expect(resolver.invocations).toHaveLength(0);
  });

  test("child lifecycle events are emitted", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => ({
      executionId: "child-exec-1",
      workflowId: "wf-child",
      status: "completed",
      artifacts: [{ id: "child-artifact", type: "test", metadata: {} }],
    }));

    const engine = createEngine(resolver);

    const definition: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-parent");

    await engine.run(
      definition,
      createExecutionContext(executionId, "wf-parent"),
    );

    const started = events.find((e) => e.type === "workflow.child_started");
    const completed = events.find((e) => e.type === "workflow.child_completed");

    expect(started).toBeDefined();
    expect(started?.executionId).toBe(executionId);
    expect(started?.payload).toMatchObject({
      parentExecutionId: executionId,
      parentWorkflowId: "wf-parent",
      parentNodeId: "child",
      childWorkflowId: "wf-child",
    });

    expect(completed).toBeDefined();
    expect(completed?.payload).toMatchObject({
      parentExecutionId: executionId,
      parentWorkflowId: "wf-parent",
      parentNodeId: "child",
      childWorkflowId: "wf-child",
      childExecutionId: "child-exec-1",
    });
  });

  test("workflow.child_failed is emitted when the child fails", async () => {
    const resolver = new StubWorkflowExecutionResolver(() => ({
      executionId: "child-exec-1",
      workflowId: "wf-child",
      status: "failed",
      artifacts: [],
      error: { code: "ERR_CHILD_BOOM", message: "child blew up" },
    }));

    const engine = createEngine(resolver);

    const definition: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-parent");

    await engine.run(
      definition,
      createExecutionContext(executionId, "wf-parent"),
    );

    const failed = events.find((e) => e.type === "workflow.child_failed");
    expect(failed).toBeDefined();
    expect(failed?.payload).toMatchObject({
      parentNodeId: "child",
      childWorkflowId: "wf-child",
      childExecutionId: "child-exec-1",
      status: "failed",
    });
  });

  test("a workflow node without a configured resolver fails the execution", async () => {
    const engine = createEngine();

    const definition: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-parent");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-parent"),
    );

    expect(result.success).toBe(false);
    expect(
      (result.error as { code?: string } | undefined)?.code,
    ).toBe("ERR_WORKFLOW_RESOLVER_NOT_CONFIGURED");
  });

  test("capability-only workflows remain compatible", async () => {
    registry.register(createCapability("cap-a"));
    registry.register(createCapability("cap-b"));

    const engine = createEngine();

    // Legacy node shape: no `kind` discriminator at all.
    const definition: WorkflowDefinition = {
      id: "wf-legacy",
      name: "legacy",
      description: "",
      nodes: [
        { id: "A", capabilityId: "cap-a", inputMap: {}, next: [] },
        {
          id: "B",
          capabilityId: "cap-b",
          inputMap: {},
          execution: { dependsOn: ["A"] },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const executionId = crypto.randomUUID();
    await createRecord(repository, executionId, "wf-legacy");

    const result = await engine.run(
      definition,
      createExecutionContext(executionId, "wf-legacy"),
    );

    expect(result.success).toBe(true);
    expect(result.completedSteps).toEqual(["A", "B"]);
    expect(result.artifacts.map((a: ArtifactRef) => a.id)).toEqual([
      "artifact-cap-a",
      "artifact-cap-b",
    ]);
  });
});

// ── WorkflowCompositionExecutor unit behaviour ──────────────────

describe("WorkflowCompositionExecutor", () => {
  test("rejects a child already present on the composition path", async () => {
    const publisher = new InMemoryEventPublisher();
    const resolver = new StubWorkflowExecutionResolver(() => {
      throw new Error("unreachable");
    });
    const executor = new WorkflowCompositionExecutor(resolver, publisher);

    await expect(
      executor.execute({
        node: {
          id: "node-1",
          kind: "workflow",
          workflowId: "wf-a",
          inputMap: {},
          next: [],
        },
        inputMap: {},
        parentExecutionId: "exec-c",
        parentWorkflowId: "wf-c",
        compositionPath: ["wf-a", "wf-b", "wf-c"],
        metadata: {},
      }),
    ).rejects.toThrow(WorkflowCompositionCycleError);
  });

  test("extends the composition path handed to the child", async () => {
    const publisher = new InMemoryEventPublisher();
    const resolver = new StubWorkflowExecutionResolver(() => ({
      executionId: "child-exec-1",
      workflowId: "wf-child",
      status: "completed",
      artifacts: [],
    }));
    const executor = new WorkflowCompositionExecutor(resolver, publisher);

    const outcome = await executor.execute({
      node: {
        id: "node-1",
        kind: "workflow",
        workflowId: "wf-child",
        inputMap: {},
        next: [],
      },
      inputMap: { seed: 1 },
      parentExecutionId: "exec-parent",
      parentWorkflowId: "wf-parent",
      compositionPath: [],
      metadata: { environment: "test" },
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.childExecutionId).toBe("child-exec-1");

    const context = resolver.invocations[0]?.context;
    const lineage = readExecutionLineage(context?.metadata);
    expect(lineage.compositionPath).toEqual(["wf-parent", "wf-child"]);
    expect(lineage.parentExecutionId).toBe("exec-parent");
    expect(lineage.parentNodeId).toBe("node-1");
    expect(context?.metadata?.environment).toBe("test");
  });
});

// ── ExecutionService end-to-end composition ─────────────────────

describe("ExecutionService workflow composition", () => {
  let logger: Logger;
  let artifactStore: ArtifactStore;
  let executionRepository: InMemoryExecutionRepository;
  let eventPublisher: InMemoryEventPublisher;
  let capabilityRegistry: CapabilityRegistry;
  let events: ExecutionEvent[];

  beforeEach(() => {
    logger = createMockLogger();
    artifactStore = createMockArtifactStore();
    executionRepository = new InMemoryExecutionRepository();
    eventPublisher = new InMemoryEventPublisher();
    capabilityRegistry = new CapabilityRegistry();
    events = [];
    eventPublisher.subscribe((event) => {
      events.push(event);
    });
  });

  const parentWithChild = (childWorkflowId: string): WorkflowDefinition => ({
    id: "wf-parent",
    name: "parent",
    description: "",
    nodes: [
      {
        id: "child",
        kind: "workflow",
        workflowId: childWorkflowId,
        inputMap: { seed: 1 },
        next: [],
      },
    ],
    metadata: { tags: [] },
  });

  const childWorkflow = (id: string, capabilityId: string): WorkflowDefinition => ({
    id,
    name: id,
    description: "",
    nodes: [{ id: "work", capabilityId, inputMap: {}, next: [] }],
    metadata: { tags: [] },
  });

  const createService = (
    packages: readonly WorkflowPackage[],
    extra?: {
      policyEvaluator?: PolicyEvaluator;
      policy?: ExecutionPolicy;
      approvalManager?: InMemoryApprovalManager;
    },
  ): ExecutionService => {
    const byId = new Map(packages.map((p) => [p.id, p]));
    const workflowResolver: WorkflowResolver = (id) => byId.get(id);

    return new ExecutionService({
      workflowResolver,
      capabilityRegistry,
      logger,
      artifactStore,
      executionRepository,
      eventPublisher,
      ...(extra?.policyEvaluator !== undefined
        ? { policyEvaluator: extra.policyEvaluator }
        : {}),
      ...(extra?.policy !== undefined ? { policy: extra.policy } : {}),
      ...(extra?.approvalManager !== undefined
        ? { approvalManager: extra.approvalManager }
        : {}),
    });
  };

  test("parent execution runs the child and returns its artifacts", async () => {
    capabilityRegistry.register(createCapability("cap-child"));

    const service = createService([
      createWorkflowPackage(parentWithChild("wf-child")),
      createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
    ]);

    const result = await service.execute({ workflowId: "wf-parent" });

    expect(result.status).toBe("completed");
    expect(result.artifacts.map((a) => a.id)).toEqual(["artifact-cap-child"]);
  });

  test("child execution record persists the parent lineage", async () => {
    capabilityRegistry.register(createCapability("cap-child"));

    const service = createService([
      createWorkflowPackage(parentWithChild("wf-child")),
      createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
    ]);

    const parentResult = await service.execute({ workflowId: "wf-parent" });

    const childRecords = await executionRepository.list("wf-child");
    expect(childRecords).toHaveLength(1);

    const childRecord = childRecords[0]!;
    expect(childRecord.executionId).not.toBe(parentResult.executionId);

    const lineage = readExecutionLineage(childRecord.metadata);
    expect(lineage.parentExecutionId).toBe(parentResult.executionId);
    expect(lineage.parentWorkflowId).toBe("wf-parent");
    expect(lineage.parentNodeId).toBe("child");
    expect(lineage.compositionPath).toEqual(["wf-parent", "wf-child"]);
  });

  test("child checkpoints do not overwrite the parent checkpoint", async () => {
    capabilityRegistry.register(createCapability("cap-child"));

    const service = createService([
      createWorkflowPackage(parentWithChild("wf-child")),
      createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
    ]);

    const parentResult = await service.execute({ workflowId: "wf-parent" });
    const childRecord = (await executionRepository.list("wf-child"))[0]!;

    const parentCheckpoint = await executionRepository.getLatestCheckpoint(
      parentResult.executionId,
    );
    const childCheckpoint = await executionRepository.getLatestCheckpoint(
      childRecord.executionId,
    );

    expect(parentCheckpoint?.executionId).toBe(parentResult.executionId);
    expect(childCheckpoint?.executionId).toBe(childRecord.executionId);
    expect(parentCheckpoint?.phase).toBe("completed");
    expect(childCheckpoint?.phase).toBe("completed");
  });

  test("a failing child fails the parent execution", async () => {
    capabilityRegistry.register(
      createCapability("cap-child", async () => {
        throw new Error("child capability exploded");
      }),
    );

    const service = createService([
      createWorkflowPackage(parentWithChild("wf-child")),
      createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
    ]);

    const result = await service.execute({ workflowId: "wf-parent" });

    expect(result.status).toBe("failed");

    const childRecord = (await executionRepository.list("wf-child"))[0]!;
    expect(childRecord.status).toBe("failed");

    const childFailed = events.find((e) => e.type === "workflow.child_failed");
    expect(childFailed).toBeDefined();
  });

  test("a child awaiting approval propagates pending_approval to the parent", async () => {
    capabilityRegistry.register(createCapability("cap-child"));

    // Approval is required for the child workflow only — the parent's own
    // policy decision is never replayed against the child.
    const policyEvaluator: PolicyEvaluator = {
      evaluate: async (
        _policy: ExecutionPolicy,
        context: PolicyContext,
      ): Promise<PolicyEvaluationResult> =>
        context.workflowId === "wf-child"
          ? {
              allowed: false,
              violations: [
                {
                  ruleId: "child-gate",
                  type: "approval_required",
                  message: "Approval required by policy rule \"child-gate\"",
                },
              ],
            }
          : { allowed: true, violations: [] },
    };

    const service = createService(
      [
        createWorkflowPackage(parentWithChild("wf-child")),
        createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
      ],
      {
        policyEvaluator,
        policy: { id: "p1", name: "policy", rules: [] },
        approvalManager: new InMemoryApprovalManager(),
      },
    );

    const result = await service.execute({ workflowId: "wf-parent" });

    expect(result.status).toBe("pending_approval");
    expect(result.error?.code).toBe("ERR_CHILD_APPROVAL_REQUIRED");

    const parentRecord = await executionRepository.get(result.executionId);
    expect(parentRecord?.status).toBe("waiting_approval");

    const childRecord = (await executionRepository.list("wf-child"))[0]!;
    expect(childRecord.status).toBe("waiting_approval");
    expect(parentRecord?.metadata?.pendingChildExecutionId).toBe(
      childRecord.executionId,
    );
  });

  test("direct cycle A -> A is rejected end to end", async () => {
    const selfReferencing: WorkflowDefinition = {
      id: "wf-a",
      name: "a",
      description: "",
      nodes: [
        {
          id: "self",
          kind: "workflow",
          workflowId: "wf-a",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const service = createService([createWorkflowPackage(selfReferencing)]);

    const result = await service.execute({ workflowId: "wf-a" });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ERR_WORKFLOW_COMPOSITION_CYCLE");

    // Exactly one execution: the cycle is caught before any child starts.
    expect(await executionRepository.list("wf-a")).toHaveLength(1);
  });

  test("indirect cycle A -> B -> A is rejected end to end", async () => {
    const wfA: WorkflowDefinition = {
      id: "wf-a",
      name: "a",
      description: "",
      nodes: [
        {
          id: "to-b",
          kind: "workflow",
          workflowId: "wf-b",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const wfB: WorkflowDefinition = {
      id: "wf-b",
      name: "b",
      description: "",
      nodes: [
        {
          id: "back-to-a",
          kind: "workflow",
          workflowId: "wf-a",
          inputMap: {},
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const service = createService([
      createWorkflowPackage(wfA),
      createWorkflowPackage(wfB),
    ]);

    const result = await service.execute({ workflowId: "wf-a" });

    expect(result.status).toBe("failed");

    // wf-b started and then failed with the stable cycle code.
    const bRecords = await executionRepository.list("wf-b");
    expect(bRecords).toHaveLength(1);
    expect(bRecords[0]?.status).toBe("failed");

    const childFailed = events.filter((e) => e.type === "workflow.child_failed");
    const cycleFailure = childFailed.find((e) => {
      const error = e.payload?.error;
      return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === "ERR_WORKFLOW_COMPOSITION_CYCLE"
      );
    });
    expect(cycleFailure).toBeDefined();

    // wf-a was never re-entered.
    expect(await executionRepository.list("wf-a")).toHaveLength(1);
  });

  test("nested composition A -> B -> C accumulates the composition path", async () => {
    capabilityRegistry.register(createCapability("cap-c"));

    const wfA: WorkflowDefinition = {
      id: "wf-a",
      name: "a",
      description: "",
      nodes: [
        { id: "to-b", kind: "workflow", workflowId: "wf-b", inputMap: {}, next: [] },
      ],
      metadata: { tags: [] },
    };

    const wfB: WorkflowDefinition = {
      id: "wf-b",
      name: "b",
      description: "",
      nodes: [
        { id: "to-c", kind: "workflow", workflowId: "wf-c", inputMap: {}, next: [] },
      ],
      metadata: { tags: [] },
    };

    const service = createService([
      createWorkflowPackage(wfA),
      createWorkflowPackage(wfB),
      createWorkflowPackage(childWorkflow("wf-c", "cap-c")),
    ]);

    const result = await service.execute({ workflowId: "wf-a" });

    expect(result.status).toBe("completed");
    expect(result.artifacts.map((a) => a.id)).toEqual(["artifact-cap-c"]);

    const bRecord = (await executionRepository.list("wf-b"))[0]!;
    const cRecord = (await executionRepository.list("wf-c"))[0]!;

    expect(readExecutionLineage(bRecord.metadata).compositionPath).toEqual([
      "wf-a",
      "wf-b",
    ]);
    expect(readExecutionLineage(cRecord.metadata).compositionPath).toEqual([
      "wf-a",
      "wf-b",
      "wf-c",
    ]);
    expect(readExecutionLineage(cRecord.metadata).parentExecutionId).toBe(
      bRecord.executionId,
    );

    const ids = new Set([
      result.executionId,
      bRecord.executionId,
      cRecord.executionId,
    ]);
    expect(ids.size).toBe(3);
  });

  test("resuming the parent after child approval reuses the child execution", async () => {
    const childRuns: unknown[] = [];
    capabilityRegistry.register(
      createCapability("cap-child", async (_ctx, input) => {
        childRuns.push(input);
        return { artifactRef: { id: "child-artifact", type: "test" } };
      }),
    );

    const downstreamRuns: string[][] = [];
    capabilityRegistry.register(
      createCapability("cap-downstream", async (ctx) => {
        downstreamRuns.push(ctx.parentArtifacts.map((a) => a.id));
        return { artifactRef: { id: "downstream-artifact", type: "test" } };
      }),
    );

    const parent: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          inputMap: {},
          next: [],
        },
        {
          id: "downstream",
          capabilityId: "cap-downstream",
          inputMap: {},
          execution: { dependsOn: ["child"] },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const policyEvaluator: PolicyEvaluator = {
      evaluate: async (
        _policy: ExecutionPolicy,
        context: PolicyContext,
      ): Promise<PolicyEvaluationResult> =>
        context.workflowId === "wf-child"
          ? {
              allowed: false,
              violations: [
                {
                  ruleId: "child-gate",
                  type: "approval_required",
                  message: "Approval required by policy rule \"child-gate\"",
                },
              ],
            }
          : { allowed: true, violations: [] },
    };

    const approvalManager = new InMemoryApprovalManager();

    const service = createService(
      [
        createWorkflowPackage(parent),
        createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
      ],
      {
        policyEvaluator,
        policy: { id: "p1", name: "policy", rules: [] },
        approvalManager,
      },
    );

    // 1. Parent blocks on the child's approval gate.
    const blocked = await service.execute({ workflowId: "wf-parent" });
    expect(blocked.status).toBe("pending_approval");
    expect(childRuns).toHaveLength(0);
    expect(downstreamRuns).toHaveLength(0);

    const childRecordBefore = (await executionRepository.list("wf-child"))[0]!;
    const approvalId = childRecordBefore.metadata?.approvalId;
    expect(typeof approvalId).toBe("string");

    // The pending checkpoint carries node-level resume state.
    const parentCheckpoint = await executionRepository.getLatestCheckpoint(
      blocked.executionId,
    );
    const composition = readCompositionCheckpoint(parentCheckpoint?.metadata);
    expect(composition).not.toBeNull();
    expect(composition?.pendingNodeId).toBe("child");
    expect(composition?.childExecutionId).toBe(childRecordBefore.executionId);
    expect(composition?.completedNodeIds).toEqual([]);

    // 2. Approve and resume the child.
    await approvalManager.approve(String(approvalId));
    const resumedChild = await service.resumeAfterApproval(String(approvalId));
    expect(resumedChild.status).toBe("completed");
    expect(childRuns).toHaveLength(1);

    // 3. Resume the parent.
    const resumedParent = await service.resume("wf-parent");

    expect(resumedParent.status).toBe("completed");
    expect(resumedParent.executionId).toBe(blocked.executionId);

    // No second child execution and no second approval request.
    const childRecords = await executionRepository.list("wf-child");
    expect(childRecords).toHaveLength(1);
    expect(childRecords[0]?.executionId).toBe(childRecordBefore.executionId);
    expect(childRuns).toHaveLength(1);

    const approvalRequests = events.filter(
      (e) => e.type === "execution.waiting_approval",
    );
    expect(
      approvalRequests.filter((e) => e.payload?.approvalId !== undefined),
    ).toHaveLength(1);

    // The blocked downstream node ran exactly once, seeing the child artifact.
    expect(downstreamRuns).toHaveLength(1);
    expect(downstreamRuns[0]).toContain("child-artifact");

    expect(resumedParent.artifacts.map((a) => a.id)).toEqual([
      "child-artifact",
      "downstream-artifact",
    ]);
  });

  test("resuming the parent while the child is still pending stays pending", async () => {
    capabilityRegistry.register(createCapability("cap-child"));

    const policyEvaluator: PolicyEvaluator = {
      evaluate: async (
        _policy: ExecutionPolicy,
        context: PolicyContext,
      ): Promise<PolicyEvaluationResult> =>
        context.workflowId === "wf-child"
          ? {
              allowed: false,
              violations: [
                {
                  ruleId: "child-gate",
                  type: "approval_required",
                  message: "Approval required by policy rule \"child-gate\"",
                },
              ],
            }
          : { allowed: true, violations: [] },
    };

    const service = createService(
      [
        createWorkflowPackage(parentWithChild("wf-child")),
        createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
      ],
      {
        policyEvaluator,
        policy: { id: "p1", name: "policy", rules: [] },
        approvalManager: new InMemoryApprovalManager(),
      },
    );

    await service.execute({ workflowId: "wf-parent" });
    const resumed = await service.resume("wf-parent");

    expect(resumed.status).toBe("pending_approval");
    expect(await executionRepository.list("wf-child")).toHaveLength(1);
  });

  test("a rejected child fails the parent on resume", async () => {
    capabilityRegistry.register(createCapability("cap-child"));

    const policyEvaluator: PolicyEvaluator = {
      evaluate: async (
        _policy: ExecutionPolicy,
        context: PolicyContext,
      ): Promise<PolicyEvaluationResult> =>
        context.workflowId === "wf-child"
          ? {
              allowed: false,
              violations: [
                {
                  ruleId: "child-gate",
                  type: "approval_required",
                  message: "Approval required by policy rule \"child-gate\"",
                },
              ],
            }
          : { allowed: true, violations: [] },
    };

    const approvalManager = new InMemoryApprovalManager();

    const service = createService(
      [
        createWorkflowPackage(parentWithChild("wf-child")),
        createWorkflowPackage(childWorkflow("wf-child", "cap-child")),
      ],
      {
        policyEvaluator,
        policy: { id: "p1", name: "policy", rules: [] },
        approvalManager,
      },
    );

    await service.execute({ workflowId: "wf-parent" });

    const childRecord = (await executionRepository.list("wf-child"))[0]!;
    const approvalId = String(childRecord.metadata?.approvalId);

    await approvalManager.reject(approvalId);
    const rejected = await service.resumeAfterApproval(approvalId);
    expect(rejected.status).toBe("failed");

    const resumedParent = await service.resume("wf-parent");
    expect(resumedParent.status).toBe("failed");
    expect(await executionRepository.list("wf-child")).toHaveLength(1);
  });

  test("mixed deny + approval violations stay denied", async () => {
    capabilityRegistry.register(createCapability("cap-a"));

    const policyEvaluator: PolicyEvaluator = {
      evaluate: async (): Promise<PolicyEvaluationResult> => ({
        allowed: false,
        violations: [
          {
            ruleId: "deny-1",
            type: "capability_denied",
            message: "Capability \"cap-a\" is denied by policy rule \"deny-1\"",
          },
          {
            ruleId: "approval-1",
            type: "approval_required",
            message: "Approval required by policy rule \"approval-1\"",
          },
        ],
      }),
    };

    const approvalManager = new InMemoryApprovalManager();

    const service = createService(
      [createWorkflowPackage(childWorkflow("wf-plain", "cap-a"))],
      {
        policyEvaluator,
        policy: { id: "p1", name: "policy", rules: [] },
        approvalManager,
      },
    );

    const result = await service.execute({ workflowId: "wf-plain" });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("ERR_POLICY_VIOLATION");

    const record = await executionRepository.get(result.executionId);
    expect(record?.status).toBe("failed");
    expect(record?.metadata?.approvalId).toBeUndefined();
    expect(
      events.some((e) => e.type === "execution.policy_denied"),
    ).toBe(true);
  });

  test("approval-only violations still enter the approval flow", async () => {
    capabilityRegistry.register(createCapability("cap-a"));

    const policyEvaluator: PolicyEvaluator = {
      evaluate: async (): Promise<PolicyEvaluationResult> => ({
        allowed: false,
        violations: [
          {
            ruleId: "approval-1",
            type: "approval_required",
            message: "Approval required by policy rule \"approval-1\"",
          },
          {
            ruleId: "approval-2",
            type: "approval_required",
            message: "Approval required by policy rule \"approval-2\"",
          },
        ],
      }),
    };

    const service = createService(
      [createWorkflowPackage(childWorkflow("wf-plain", "cap-a"))],
      {
        policyEvaluator,
        policy: { id: "p1", name: "policy", rules: [] },
        approvalManager: new InMemoryApprovalManager(),
      },
    );

    const result = await service.execute({ workflowId: "wf-plain" });
    expect(result.status).toBe("pending_approval");
  });

  test("parent input reaches a child capability", async () => {
    const received: unknown[] = [];
    capabilityRegistry.register(
      createCapability("cap-child", async (_ctx, input) => {
        received.push(input);
        return { artifactRef: { id: "child-artifact", type: "test" } };
      }),
    );

    const parent: WorkflowDefinition = {
      id: "wf-parent",
      name: "parent",
      description: "",
      nodes: [
        {
          id: "child",
          kind: "workflow",
          workflowId: "wf-child",
          // The parent forwards its own input into the child invocation.
          inputMap: { $workflowInput: true },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const child: WorkflowDefinition = {
      id: "wf-child",
      name: "child",
      description: "",
      nodes: [
        {
          id: "work",
          capabilityId: "cap-child",
          inputMap: { greeting: { $workflowInput: "message" } },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const service = createService([
      createWorkflowPackage(parent),
      createWorkflowPackage(child),
    ]);

    const result = await service.execute({
      workflowId: "wf-parent",
      input: { message: "hello from parent" },
    });

    expect(result.status).toBe("completed");
    expect(received).toEqual([{ greeting: "hello from parent" }]);

    const childRecord = (await executionRepository.list("wf-child"))[0]!;
    expect(readExecutionInput(childRecord.metadata)).toEqual({
      message: "hello from parent",
    });
  });

  test("root request input reaches a capability node", async () => {
    const received: unknown[] = [];
    capabilityRegistry.register(
      createCapability("cap-a", async (_ctx, input) => {
        received.push(input);
        return { artifactRef: { id: "artifact-cap-a", type: "test" } };
      }),
    );

    const definition: WorkflowDefinition = {
      id: "wf-plain",
      name: "plain",
      description: "",
      nodes: [
        {
          id: "work",
          capabilityId: "cap-a",
          inputMap: { $workflowInput: true },
          next: [],
        },
      ],
      metadata: { tags: [] },
    };

    const service = createService([createWorkflowPackage(definition)]);

    const result = await service.execute({
      workflowId: "wf-plain",
      input: { seed: 42 },
    });

    expect(result.status).toBe("completed");
    expect(received).toEqual([{ seed: 42 }]);
  });

  test("capability-only workflows still execute through the service", async () => {
    capabilityRegistry.register(createCapability("cap-a"));

    const service = createService([
      createWorkflowPackage(childWorkflow("wf-plain", "cap-a")),
    ]);

    const result = await service.execute({ workflowId: "wf-plain" });

    expect(result.status).toBe("completed");
    expect(result.artifacts.map((a) => a.id)).toEqual(["artifact-cap-a"]);
  });
});
