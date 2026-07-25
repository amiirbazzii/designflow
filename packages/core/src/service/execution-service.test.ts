import { describe, expect, test, beforeEach } from "bun:test";
import { z } from "zod";
import { ExecutionService } from "./execution-service";
import type {
  WorkflowPackage,
  WorkflowResolver,
  Logger,
  StateStore,
  ArtifactStore,
  Capability,
  ArtifactRef,
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

const createMockStateStore = (): StateStore => ({
  saveCheckpoint: async () => {},
  loadCheckpoint: async () => null,
  listHistory: async () => [],
  getLatestCheckpoint: async () => null,
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
  capabilities: Capability<unknown, unknown>[] = [],
): WorkflowPackage => ({
  id,
  name: `Workflow ${id}`,
  version: "1.0.0",
  definition: {
    id,
    name: `Workflow ${id}`,
    description: "",
    nodes: capabilities.map((cap) => ({
      id: cap.id,
      capabilityId: cap.id,
      inputMap: {},
    })),
    metadata: {},
  },
  load: (registrar) => {
    for (const cap of capabilities) {
      registrar.register(cap);
    }
  },
});

// ── Tests ───────────────────────────────────────────────────────

describe("ExecutionService", () => {
  let logger: Logger;
  let stateStore: StateStore;
  let artifactStore: ArtifactStore;

  beforeEach(() => {
    logger = createMockLogger();
    stateStore = createMockStateStore();
    artifactStore = createMockArtifactStore();
  });

  describe("validate execution request", () => {
    test("valid request is accepted", async () => {
      const cap = createMockCapability("test-cap");
      const workflow = createWorkflowPackage("test-wf", [cap]);
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        logger,
        stateStore,
        artifactStore,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.workflowId).toBe("test-wf");
      expect(result.status).toBe("completed");
    });

    test("invalid request with empty workflowId is rejected", async () => {
      const service = new ExecutionService({
        workflowResolver: () => undefined,
        logger,
        stateStore,
        artifactStore,
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
        logger,
        stateStore,
        artifactStore,
      });

      await expect(
        service.execute({ workflowId: "nonexistent" }),
      ).rejects.toThrow("Workflow not found: nonexistent");
    });
  });

  describe("successful execution contract", () => {
    test("returns completed status with artifacts", async () => {
      const cap = createMockCapability("test-cap");
      const workflow = createWorkflowPackage("test-wf", [cap]);
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        logger,
        stateStore,
        artifactStore,
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
      const workflow = createWorkflowPackage("test-wf", [cap]);
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        logger,
        stateStore,
        artifactStore,
      });

      const result = await service.execute({
        workflowId: "test-wf",
        metadata: { key: "value" },
      });

      expect(result.status).toBe("completed");
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

      const workflow = createWorkflowPackage("test-wf", [failingCap]);
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        logger,
        stateStore,
        artifactStore,
      });

      const result = await service.execute({ workflowId: "test-wf" });

      expect(result.executionId).toBeDefined();
      expect(result.workflowId).toBe("test-wf");
      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain("failing-cap");
    });
  });

  describe("resume contract", () => {
    test("resume with no checkpoint throws error", async () => {
      const cap = createMockCapability("test-cap");
      const workflow = createWorkflowPackage("test-wf", [cap]);
      const resolver: WorkflowResolver = (id) => (id === "test-wf" ? workflow : undefined);

      const service = new ExecutionService({
        workflowResolver: resolver,
        logger,
        stateStore,
        artifactStore,
      });

      await expect(service.resume("test-wf")).rejects.toThrow(
        "No checkpoint found to resume from",
      );
    });
  });
});
