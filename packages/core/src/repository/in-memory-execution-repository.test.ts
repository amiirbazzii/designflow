// packages/core/src/repository/in-memory-execution-repository.test.ts
import { describe, expect, test, beforeEach } from "bun:test";
import { InMemoryExecutionRepository } from "./in-memory-execution-repository";
import type {
  ExecutionRecord,
  LifecycleEvent,
  ExecutionCheckpointData,
} from "@designflow/sdk";

// ── Test Helpers ────────────────────────────────────────────────

const createTestRecord = (
  executionId: string,
  workflowId: string,
): ExecutionRecord => ({
  executionId,
  workflowId,
  status: "running",
  startedAt: Date.now(),
});

const createTestEvent = (
  executionId: string,
  phase: LifecycleEvent["phase"],
): LifecycleEvent => ({
  executionId,
  phase,
  timestamp: Date.now(),
});

const createTestCheckpoint = (
  executionId: string,
  phase: string,
): ExecutionCheckpointData => ({
  executionId,
  phase,
  timestamp: Date.now(),
  state: { test: true },
  metadata: {},
});

// ── Tests ───────────────────────────────────────────────────────

describe("InMemoryExecutionRepository", () => {
  let repository: InMemoryExecutionRepository;

  beforeEach(() => {
    repository = new InMemoryExecutionRepository();
  });

  describe("execution records", () => {
    test("create execution record", async () => {
      const record = createTestRecord("exec-1", "wf-1");

      await repository.create(record);

      const retrieved = await repository.get("exec-1");
      expect(retrieved).toEqual(record);
    });

    test("create duplicate execution record throws", async () => {
      const record = createTestRecord("exec-1", "wf-1");

      await repository.create(record);

      await expect(repository.create(record)).rejects.toThrow(
        "Execution record already exists: exec-1",
      );
    });

    test("update execution record status", async () => {
      const record = createTestRecord("exec-1", "wf-1");
      await repository.create(record);

      await repository.update("exec-1", { status: "completed" });

      const retrieved = await repository.get("exec-1");
      expect(retrieved?.status).toBe("completed");
    });

    test("update non-existent execution record throws", async () => {
      await expect(
        repository.update("nonexistent", { status: "completed" }),
      ).rejects.toThrow("Execution record not found: nonexistent");
    });

    test("get execution record returns null for non-existent", async () => {
      const result = await repository.get("nonexistent");
      expect(result).toBeNull();
    });

    test("list execution records by workflowId", async () => {
      await repository.create(createTestRecord("exec-1", "wf-1"));
      await repository.create(createTestRecord("exec-2", "wf-1"));
      await repository.create(createTestRecord("exec-3", "wf-2"));

      const results = await repository.list("wf-1");
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.executionId)).toContain("exec-1");
      expect(results.map((r) => r.executionId)).toContain("exec-2");
    });

    test("list execution records returns empty for no matches", async () => {
      await repository.create(createTestRecord("exec-1", "wf-1"));

      const results = await repository.list("wf-2");
      expect(results).toHaveLength(0);
    });
  });

  describe("lifecycle events", () => {
    test("append lifecycle event", async () => {
      const record = createTestRecord("exec-1", "wf-1");
      await repository.create(record);

      const event = createTestEvent("exec-1", "created");
      await repository.appendEvent(event);

      const events = await repository.listEvents("exec-1");
      expect(events).toHaveLength(1);
      expect(events[0].phase).toBe("created");
    });

    test("append event to non-existent execution throws", async () => {
      const event = createTestEvent("nonexistent", "created");

      await expect(repository.appendEvent(event)).rejects.toThrow(
        "No execution record found for event: nonexistent",
      );
    });

    test("list events returns empty for non-existent execution", async () => {
      const events = await repository.listEvents("nonexistent");
      expect(events).toHaveLength(0);
    });

    test("append multiple events in order", async () => {
      const record = createTestRecord("exec-1", "wf-1");
      await repository.create(record);

      await repository.appendEvent(createTestEvent("exec-1", "created"));
      await repository.appendEvent(createTestEvent("exec-1", "executing"));
      await repository.appendEvent(createTestEvent("exec-1", "completed"));

      const events = await repository.listEvents("exec-1");
      expect(events).toHaveLength(3);
      expect(events[0].phase).toBe("created");
      expect(events[1].phase).toBe("executing");
      expect(events[2].phase).toBe("completed");
    });
  });

  describe("checkpoints", () => {
    test("save and get checkpoint", async () => {
      const record = createTestRecord("exec-1", "wf-1");
      await repository.create(record);

      const checkpoint = createTestCheckpoint("exec-1", "started");
      await repository.saveCheckpoint("exec-1", checkpoint);

      const retrieved = await repository.getLatestCheckpoint("exec-1");
      expect(retrieved).toEqual(checkpoint);
    });

    test("save checkpoint for non-existent execution throws", async () => {
      const checkpoint = createTestCheckpoint("nonexistent", "started");

      await expect(
        repository.saveCheckpoint("nonexistent", checkpoint),
      ).rejects.toThrow("Execution record not found for checkpoint: nonexistent");
    });

    test("get checkpoint returns null for non-existent execution", async () => {
      const result = await repository.getLatestCheckpoint("nonexistent");
      expect(result).toBeNull();
    });

    test("save checkpoint overwrites previous", async () => {
      const record = createTestRecord("exec-1", "wf-1");
      await repository.create(record);

      const checkpoint1 = createTestCheckpoint("exec-1", "started");
      const checkpoint2 = createTestCheckpoint("exec-1", "completed");

      await repository.saveCheckpoint("exec-1", checkpoint1);
      await repository.saveCheckpoint("exec-1", checkpoint2);

      const retrieved = await repository.getLatestCheckpoint("exec-1");
      expect(retrieved?.phase).toBe("completed");
    });

    test("save checkpoint with mismatched execution ID throws", async () => {
      const record = createTestRecord("exec-1", "wf-1");
      await repository.create(record);

      const checkpoint = createTestCheckpoint("exec-2", "started");

      await expect(
        repository.saveCheckpoint("exec-1", checkpoint),
      ).rejects.toThrow("Checkpoint execution ID mismatch");
    });
  });
});
