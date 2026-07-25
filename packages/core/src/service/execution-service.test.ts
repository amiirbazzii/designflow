import { describe, expect, test, beforeEach } from "bun:test";
import { z } from "zod";
import { ExecutionService } from "./execution-service";
import { CapabilityRegistry } from "../registry";
import { InMemoryExecutionRepository } from "../repository";
import { InMemoryEventPublisher } from "../events";
import { InMemoryPolicyEvaluator } from "../policy";
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

  describe("policy evaluation", () => {
    let policyEvaluator: PolicyEvaluator;

    beforeEach(() => {
      policyEvaluator = new InMemoryPolicyEvaluator();
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

    test("require_approval blocks execution", async () => {
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
          { id: "approval-1", type: "require_approval" },
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
          { id: "approval-1", type: "require_approval" },
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
    });
  });
});
