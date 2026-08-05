// packages/core/src/application/execution/execution-service.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { z } from "zod";
import { ExecutionService } from "./execution-service";
import { CapabilityRegistry } from "../../registry";
import { InMemoryExecutionRepository } from "../../repository";
import { InMemoryEventPublisher, ExecutionEventRepositorySubscriber } from "../../events";
import { InMemoryPolicyEvaluator } from "../../policy";
import { InMemoryApprovalManager } from "../../approval";
import type {
  WorkflowPackage,
  WorkflowResolver,
  Logger,
  ArtifactStore,
  Capability,
  ExecutionRepository,
  ExecutionEventPublisher,
  ExecutionPolicy,
  PolicyEvaluator,
  ExecutionEvent,
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

const createWorkflowPackage = (
  id: string,
): WorkflowPackage => ({
  id,
  name: `Workflow ${id}`,
  version: "1.0.0",
  definition: {
    id,
    name: `Workflow ${id}`,
    description: "",
    nodes: [],
    metadata: {},
  },
  load: () => {},
});

// ── Tests ───────────────────────────────────────────────────────

describe("ExecutionService", () => {
  let logger: Logger;
  let artifactStore: ArtifactStore;
  let executionRepository: ExecutionRepository;
  let eventPublisher: ExecutionEventPublisher;
  let capabilityRegistry: CapabilityRegistry;

  beforeEach(() => {
    logger = createMockLogger();
    artifactStore = createMockArtifactStore();
    executionRepository = new InMemoryExecutionRepository();
    eventPublisher = new InMemoryEventPublisher();
    capabilityRegistry = new CapabilityRegistry();
  });

  describe("validate execution request", () => {
    test("valid request is accepted", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.workflowId).toBe("test-wf");
      expect(result.status).toBe("completed");
    });

    test("invalid request with empty workflowId is rejected", async () => {
      const service = new ExecutionService({
        workflowResolver: () => undefined,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      await expect(
        service.execute({ workflowId: "" }),
      ).rejects.toThrow("Invalid execution request");
    });
  });

  describe("resolve WorkflowPackage", () => {
    test("workflow not found throws WorkflowNotFoundError", async () => {
      const resolver: WorkflowResolver = () => undefined;
      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      await expect(
        service.execute({ workflowId: "nonexistent" }),
      ).rejects.toThrow("Workflow not found: nonexistent");
    });
  });

  describe("successful execution contract", () => {
    test("returns completed status with artifacts", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.executionId).toBeDefined();
      expect(result.workflowId).toBe("test-wf");
      expect(result.status).toBe("completed");
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0].id).toBe("artifact-test-cap");
      expect(result.error).toBeUndefined();
    });

    test("execution with metadata passes metadata to context", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({
        workflowId: "test-wf",
        metadata: { key: "value" },
      });

      expect(result.status).toBe("completed");
    });

    test("successful execution persists events to repository", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      const events = await executionRepository.listEvents(result.executionId);
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[0].phase).toBe("created");
      expect(events[1].phase).toBe("executing");
      expect(events[events.length - 1].phase).toBe("completed");

      const record = await executionRepository.get(result.executionId);
      expect(record?.status).toBe("completed");
      expect(record?.completedAt).toBeDefined();
    });
  });

  describe("failed execution contract", () => {
    test("returns failed status when capability throws", async () => {
      const failingCap: Capability<unknown, unknown> = {
        id: "failing-cap",
        name: "Failing Capability",
        description: "A capability that fails",
        type: "pure",
        inputSchema: passthroughSchema,
        outputSchema: passthroughSchema,
        execute: async () => {
          throw new Error("Capability execution failed");
        },
      };

      capabilityRegistry.register(failingCap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "failing-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.executionId).toBeDefined();
      expect(result.workflowId).toBe("test-wf");
      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain("node-1");
    });

    test("failed execution persists failed state to repository", async () => {
      const failingCap: Capability<unknown, unknown> = {
        id: "failing-cap",
        name: "Failing Capability",
        description: "A capability that fails",
        type: "pure",
        inputSchema: passthroughSchema,
        outputSchema: passthroughSchema,
        execute: async () => {
          throw new Error("Capability execution failed");
        },
      };

      capabilityRegistry.register(failingCap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "failing-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      const events = await executionRepository.listEvents(result.executionId);
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events[events.length - 1].phase).toBe("failed");

      const record = await executionRepository.get(result.executionId);
      expect(record?.status).toBe("failed");
      expect(record?.completedAt).toBeDefined();
    });
  });

  describe("resume contract", () => {
    test("resume with no checkpoint throws error", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      await expect(service.resume("test-wf")).rejects.toThrow(
        "No checkpoint found to resume from",
      );
    });

    test("options.resume triggers resume method", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      await expect(
        service.execute({ workflowId: "test-wf", options: { resume: true } }),
      ).rejects.toThrow("No checkpoint found to resume from");
    });

    test("resume reads repository for execution history", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("completed");

      const events = await executionRepository.listEvents(result.executionId);
      expect(events.length).toBeGreaterThan(0);

      const record = await executionRepository.get(result.executionId);
      expect(record).toBeDefined();
      expect(record?.workflowId).toBe("test-wf");
    });
  });

  describe("resume completed execution", () => {
    test("resume preserves artifacts from checkpoint", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("completed");
      expect(result.artifacts).toHaveLength(1);

      const service2 = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const resumed = await service2.resume("test-wf");

      expect(resumed.executionId).toBe(result.executionId);
      expect(resumed.status).toBe("completed");
      expect(resumed.artifacts).toHaveLength(1);
      expect(resumed.artifacts[0].id).toBe("artifact-test-cap");
    });
  });

  describe("root cancellation", () => {
    test("an already-aborted signal cancels before any capability runs", async () => {
      let executed = 0;
      const cap = createMockCapability("never-cap");
      capabilityRegistry.register({
        ...cap,
        execute: async (context, input) => {
          executed += 1;
          return cap.execute(context, input);
        },
      });

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [{ id: "node-1", capabilityId: "never-cap", inputMap: {} }];
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const controller = new AbortController();
      controller.abort();

      const result = await service.execute({ workflowId: "test-wf" }, { signal: controller.signal });

      expect(result.status).toBe("cancelled");
      expect(result.error?.code).toBe("ERR_EXECUTION_CANCELLED");
      expect(executed).toBe(0);

      const record = await executionRepository.get(result.executionId);
      expect(record?.status).toBe("cancelled");
    });

    test("cancellation between layers stops later nodes, records cancelled, and emits no success artifacts", async () => {
      const controller = new AbortController();
      let secondNodeRuns = 0;
      let firstNodeArtifacts = 0;

      const first = createMockCapability("first-cap");
      capabilityRegistry.register({
        ...first,
        execute: async (context, input) => {
          const out = await first.execute(context, input);
          firstNodeArtifacts += 1;
          // The user presses Ctrl+C while the first step is finishing.
          controller.abort();
          return out;
        },
      });
      const second = createMockCapability("second-cap");
      capabilityRegistry.register({
        ...second,
        execute: async (context, input) => {
          secondNodeRuns += 1;
          return second.execute(context, input);
        },
      });

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "first-cap", inputMap: {} },
        { id: "node-2", capabilityId: "second-cap", inputMap: {}, execution: { dependsOn: ["node-1"] } },
      ];
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" }, { signal: controller.signal });

      expect(result.status).toBe("cancelled");
      expect(result.artifacts).toEqual([]);
      expect(firstNodeArtifacts).toBe(1);
      expect(secondNodeRuns).toBe(0);

      const record = await executionRepository.get(result.executionId);
      expect(record?.status).toBe("cancelled");
      expect(record?.status).not.toBe("running");
    });

    test("the root signal reaches a running capability's context", async () => {
      const controller = new AbortController();
      let started: (() => void) | undefined;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      let observedAbort = false;

      const cap = createMockCapability("waiting-cap");
      capabilityRegistry.register({
        ...cap,
        execute: async (context, input) => {
          started?.();
          await new Promise<void>((resolve) => {
            if (context.signal.aborted) { resolve(); return; }
            context.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          observedAbort = context.signal.aborted;
          return cap.execute(context, input);
        },
      });

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [{ id: "node-1", capabilityId: "waiting-cap", inputMap: {} }];
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const pending = service.execute({ workflowId: "test-wf" }, { signal: controller.signal });
      await startedPromise;
      controller.abort();
      const result = await pending;

      expect(observedAbort).toBe(true);
      expect(result.status).toBe("cancelled");
    });

    test("resume cannot treat a cancelled execution as successful", async () => {
      const controller = new AbortController();
      controller.abort();
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [{ id: "node-1", capabilityId: "test-cap", inputMap: {} }];
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const cancelled = await service.execute({ workflowId: "test-wf" }, { signal: controller.signal });
      expect(cancelled.status).toBe("cancelled");

      const resumed = await service.resume("test-wf");
      expect(resumed.status).toBe("cancelled");
      expect(resumed.error?.code).toBe("WORKFLOW_PREVIOUSLY_TERMINATED");
    });
  });

  describe("policy evaluation", () => {
    let policyEvaluator: PolicyEvaluator;

    beforeEach(() => {
      policyEvaluator = new InMemoryPolicyEvaluator();

      const repositorySubscriber = new ExecutionEventRepositorySubscriber(
        executionRepository,
      );
      eventPublisher.subscribe(repositorySubscriber.createHandler());
    });

    test("execution with no policy passes", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("completed");
    });

    test("deny capability blocks execution", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Deny Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("ERR_POLICY_VIOLATION");
      expect(result.error?.message).toContain("test-cap");
    });

    test("a workflowId-only policy rule is rejected before any capability runs", async () => {
      let executed = 0;
      const cap = createMockCapability("side-effect-cap");
      capabilityRegistry.register({
        ...cap,
        execute: async (context, input) => {
          executed += 1;
          return cap.execute(context, input);
        },
      });

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "side-effect-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      // Structurally invalid under the target contract: workflowId is only
      // a scope qualifier. The rule must be rejected at the evaluation
      // parsing boundary — not silently ignored (fail-open) and not
      // treated as match-all — and nothing side-effecting may run first.
      // Type-checks because the refine constrains parsing, not the inferred
      // type — exactly why the runtime boundary must reject it.
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Invalid workflow-only policy",
        rules: [
          { id: "bad-1", type: "require_approval", target: { workflowId: "test-wf" } },
        ],
      };

      // The earliest reliable boundary is ExecutionService construction,
      // which parses the policy — the invalid rule never survives to an
      // execution at all.
      const construct = (): ExecutionService =>
        new ExecutionService({
          workflowResolver: resolver,
          capabilityRegistry,
          logger,
          artifactStore,
          executionRepository,
          eventPublisher,
          policyEvaluator,
          policy,
        });

      expect(construct).toThrow(/nodeId or a capabilityId/);
      expect(executed).toBe(0);
    });

    test("a raw resource_limit rule fails at construction before any capability can run", async () => {
      let executed = 0;
      const cap = createMockCapability("metered-cap");
      capabilityRegistry.register({
        ...cap,
        execute: async (context, input) => {
          executed += 1;
          return cap.execute(context, input);
        },
      });

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "metered-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      // resource_limit is no longer part of the public union, so simulate
      // raw persisted/configured data via a narrow structural mutation.
      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Removed resource policy",
        rules: [{ id: "limit-1", type: "deny_capability", target: "memory" }],
      };
      (policy.rules[0] as { type?: unknown }).type = "resource_limit";

      const construct = (): ExecutionService =>
        new ExecutionService({
          workflowResolver: resolver,
          capabilityRegistry,
          logger,
          artifactStore,
          executionRepository,
          eventPublisher,
          policyEvaluator,
          policy,
        });

      expect(construct).toThrow(/Unsupported policy rule type/);
      expect(executed).toBe(0);
    });

    test("require_approval without approval manager still fails", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("ERR_POLICY_VIOLATION");
      expect(result.error?.message).toContain("Approval required");
    });

    test("multiple violations are returned", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Combined Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "test-cap" },
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("test-cap");
      expect(result.error?.message).toContain("Approval required");
    });

    test("allow policy passes for listed capabilities", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Allow Policy",
        rules: [
          { id: "allow-1", type: "allow_capability", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("completed");
    });

    test("policy violation persists failed state to repository", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Deny Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      const record = await executionRepository.get(result.executionId);
      expect(record?.status).toBe("failed");
      expect(record?.completedAt).toBeDefined();
    });

    test("policy denied execution persists governance event to repository", async () => {
      const receivedEvents: ExecutionEvent[] = [];
      eventPublisher.subscribe((event) => {
        receivedEvents.push(event);
      });

      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Deny Policy",
        rules: [
          { id: "deny-1", type: "deny_capability", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("failed");

      const policyDeniedEvents = receivedEvents.filter(
        (e) => e.type === "execution.policy_denied",
      );
      expect(policyDeniedEvents.length).toBe(1);
      expect(policyDeniedEvents[0].executionId).toBe(result.executionId);
      expect(policyDeniedEvents[0].payload).toBeDefined();

      const repositoryEvents = await executionRepository.listEvents(
        result.executionId,
      );
      expect(repositoryEvents.length).toBeGreaterThanOrEqual(2);

      const policyDeniedInRepository = repositoryEvents.some(
        (event) =>
          event.metadata !== undefined &&
          typeof event.metadata === "object" &&
          "eventType" in event.metadata &&
          event.metadata.eventType === "execution.policy_denied",
      );
      expect(policyDeniedInRepository).toBe(true);
    });
  });

  describe("approval flow", () => {
    let policyEvaluator: PolicyEvaluator;
    let approvalManager: InMemoryApprovalManager;

    beforeEach(() => {
      policyEvaluator = new InMemoryPolicyEvaluator();
      approvalManager = new InMemoryApprovalManager();

      const repositorySubscriber = new ExecutionEventRepositorySubscriber(
        executionRepository,
      );
      eventPublisher.subscribe(repositorySubscriber.createHandler());
    });

    test("policy creates approval instead of failure", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.status).toBe("pending_approval");
      expect(result.error?.code).toBe("ERR_APPROVAL_REQUIRED");
      expect(result.error?.message).toContain("Approval required");
    });

    test("approval creates waiting_approval execution record", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      const record = await executionRepository.get(result.executionId);
      expect(record?.status).toBe("waiting_approval");
    });

    test("approved request resumes execution", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const result = await service.execute({ workflowId: "test-wf" });
      expect(result.status).toBe("pending_approval");

      const record = await executionRepository.get(result.executionId);
      const approvalId = record?.metadata?.approvalId as string;
      expect(approvalId).toBeDefined();

      const approved = await approvalManager.approve(approvalId);
      expect(approved.status).toBe("approved");

      const resumed = await service.resumeAfterApproval(approvalId);
      expect(resumed.status).toBe("completed");
      expect(resumed.artifacts).toHaveLength(1);
    });

    test("rejected request stops execution", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const result = await service.execute({ workflowId: "test-wf" });
      expect(result.status).toBe("pending_approval");

      const record = await executionRepository.get(result.executionId);
      const approvalId = record?.metadata?.approvalId as string;

      await approvalManager.reject(approvalId);

      const resumed = await service.resumeAfterApproval(approvalId);
      expect(resumed.status).toBe("failed");
      expect(resumed.error?.code).toBe("ERR_APPROVAL_REJECTED");
    });

    test("pending approval returns pending result on resumeAfterApproval", async () => {
      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const result = await service.execute({ workflowId: "test-wf" });
      expect(result.status).toBe("pending_approval");

      const record = await executionRepository.get(result.executionId);
      const approvalId = record?.metadata?.approvalId as string;

      const resumed = await service.resumeAfterApproval(approvalId);
      expect(resumed.status).toBe("pending_approval");
      expect(resumed.error?.code).toBe("ERR_APPROVAL_PENDING");
    });

    test("resumeAfterApproval without approval manager throws", async () => {
      const service = new ExecutionService({
        workflowResolver: () => undefined,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
      });

      await expect(service.resumeAfterApproval("any")).rejects.toThrow("Approval manager not configured");
    });

    test("execution.waiting_approval event is published", async () => {
      const receivedEvents: ExecutionEvent[] = [];
      eventPublisher.subscribe((event) => {
        receivedEvents.push(event);
      });

      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      await service.execute({ workflowId: "test-wf" });

      const waitingEvents = receivedEvents.filter(
        (e) => e.type === "execution.waiting_approval",
      );
      expect(waitingEvents.length).toBe(1);
      expect(waitingEvents[0].payload?.approvalId).toBeDefined();
      expect(waitingEvents[0].payload?.reason).toContain("Approval required");
    });

    test("execution.approval_approved event is published on resume after approval", async () => {
      const receivedEvents: ExecutionEvent[] = [];
      eventPublisher.subscribe((event) => {
        receivedEvents.push(event);
      });

      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const execResult = await service.execute({ workflowId: "test-wf" });
      const record = await executionRepository.get(execResult.executionId);
      const approvalId = record?.metadata?.approvalId as string;

      await approvalManager.approve(approvalId);

      const eventsBefore = receivedEvents.length;
      await service.resumeAfterApproval(approvalId);

      const approvalEvents = receivedEvents.slice(eventsBefore).filter(
        (e) => e.type === "execution.approval_approved",
      );
      expect(approvalEvents.length).toBe(1);
    });

    test("execution.approval_approved event includes comment and resolvedAt", async () => {
      const receivedEvents: ExecutionEvent[] = [];
      eventPublisher.subscribe((event) => {
        receivedEvents.push(event);
      });

      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const execResult = await service.execute({ workflowId: "test-wf" });
      const record = await executionRepository.get(execResult.executionId);
      const approvalId = record?.metadata?.approvalId as string;

      await approvalManager.approve(approvalId, "Approved by reviewer");

      const eventsBefore = receivedEvents.length;
      await service.resumeAfterApproval(approvalId);

      const approvalEvents = receivedEvents.slice(eventsBefore).filter(
        (e) => e.type === "execution.approval_approved",
      );
      expect(approvalEvents.length).toBe(1);
      expect(approvalEvents[0].payload?.comment).toBe("Approved by reviewer");
      expect(approvalEvents[0].payload?.resolvedAt).toBeGreaterThan(0);
    });

    test("execution.approval_rejected event includes comment and resolvedAt", async () => {
      const receivedEvents: ExecutionEvent[] = [];
      eventPublisher.subscribe((event) => {
        receivedEvents.push(event);
      });

      const cap = createMockCapability("test-cap");
      capabilityRegistry.register(cap);

      const workflow = createWorkflowPackage("test-wf");
      workflow.definition.nodes = [
        { id: "node-1", capabilityId: "test-cap", inputMap: {} },
      ];

      const resolver: WorkflowResolver = (id) =>
        id === "test-wf" ? workflow : undefined;

      const policy: ExecutionPolicy = {
        id: "policy-1",
        name: "Approval Policy",
        rules: [
          { id: "approval-1", type: "require_approval", target: "test-cap" },
        ],
      };

      const service = new ExecutionService({
        workflowResolver: resolver,
        capabilityRegistry,
        logger,
        artifactStore,
        executionRepository,
        eventPublisher,
        policyEvaluator,
        policy,
        approvalManager,
      });

      const execResult = await service.execute({ workflowId: "test-wf" });
      const record = await executionRepository.get(execResult.executionId);
      const approvalId = record?.metadata?.approvalId as string;

      await approvalManager.reject(approvalId, "Rejected by reviewer");

      const eventsBefore = receivedEvents.length;
      await service.resumeAfterApproval(approvalId);

      const rejectEvents = receivedEvents.slice(eventsBefore).filter(
        (e) => e.type === "execution.approval_rejected",
      );
      expect(rejectEvents.length).toBe(1);
      expect(rejectEvents[0].payload?.comment).toBe("Rejected by reviewer");
      expect(rejectEvents[0].payload?.resolvedAt).toBeGreaterThan(0);
    });
  });
});
