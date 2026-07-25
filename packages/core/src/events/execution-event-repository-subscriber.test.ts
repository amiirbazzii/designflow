import { describe, expect, test, beforeEach } from "bun:test";
import { ExecutionEventRepositorySubscriber } from "./execution-event-repository-subscriber";
import { InMemoryExecutionRepository } from "../repository";
import type { ExecutionEvent, ExecutionRepository, Logger } from "@designflow/sdk";

// ── Test Helpers ────────────────────────────────────────────────

const createTestEvent = (
  type: ExecutionEvent["type"],
  executionId = "exec-1",
): ExecutionEvent => ({
  id: crypto.randomUUID(),
  executionId,
  type,
  timestamp: Date.now(),
});

const createMockLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

// ── Tests ───────────────────────────────────────────────────────

describe("ExecutionEventRepositorySubscriber", () => {
  let repository: ExecutionRepository;
  let subscriber: ExecutionEventRepositorySubscriber;

  beforeEach(async () => {
    repository = new InMemoryExecutionRepository();
    subscriber = new ExecutionEventRepositorySubscriber(repository);
  });

  test("execution.started maps to created phase", async () => {
    await repository.create({
      executionId: "exec-1",
      workflowId: "wf-1",
      status: "running",
      startedAt: Date.now(),
    });

    const handler = subscriber.createHandler();
    const event = createTestEvent("execution.started");

    await handler(event);

    const events = await repository.listEvents("exec-1");
    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe("created");
  });

  test("execution.planning maps to planning phase", async () => {
    await repository.create({
      executionId: "exec-1",
      workflowId: "wf-1",
      status: "running",
      startedAt: Date.now(),
    });

    const handler = subscriber.createHandler();
    const event = createTestEvent("execution.planning");

    await handler(event);

    const events = await repository.listEvents("exec-1");
    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe("planning");
  });

  test("execution.completed maps to completed phase", async () => {
    await repository.create({
      executionId: "exec-1",
      workflowId: "wf-1",
      status: "running",
      startedAt: Date.now(),
    });

    const handler = subscriber.createHandler();
    const event = createTestEvent("execution.completed");

    await handler(event);

    const events = await repository.listEvents("exec-1");
    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe("completed");
  });

  test("execution.failed maps to failed phase", async () => {
    await repository.create({
      executionId: "exec-1",
      workflowId: "wf-1",
      status: "running",
      startedAt: Date.now(),
    });

    const handler = subscriber.createHandler();
    const event = createTestEvent("execution.failed");

    await handler(event);

    const events = await repository.listEvents("exec-1");
    expect(events).toHaveLength(1);
    expect(events[0].phase).toBe("failed");
  });

  test("capability events are ignored", async () => {
    await repository.create({
      executionId: "exec-1",
      workflowId: "wf-1",
      status: "running",
      startedAt: Date.now(),
    });

    const handler = subscriber.createHandler();

    await handler(createTestEvent("capability.started"));
    await handler(createTestEvent("capability.completed"));
    await handler(createTestEvent("capability.failed"));

    const events = await repository.listEvents("exec-1");
    expect(events).toHaveLength(0);
  });

  test("event metadata is preserved", async () => {
    await repository.create({
      executionId: "exec-1",
      workflowId: "wf-1",
      status: "running",
      startedAt: Date.now(),
    });

    const handler = subscriber.createHandler();
    const event = createTestEvent("execution.started");
    event.payload = { workflowId: "wf-1", test: true };

    await handler(event);

    const events = await repository.listEvents("exec-1");
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toBeDefined();
    expect(events[0].metadata?.eventType).toBe("execution.started");
    expect(events[0].metadata?.eventId).toBe(event.id);
    expect(events[0].metadata?.payload).toEqual({ workflowId: "wf-1", test: true });
  });

  test("repository failure does not throw", async () => {
    const failingRepository: ExecutionRepository = {
      create: async () => { throw new Error("DB error"); },
      update: async () => {},
      get: async () => null,
      list: async () => [],
      appendEvent: async () => { throw new Error("DB error"); },
      listEvents: async () => [],
      saveCheckpoint: async () => {},
      getLatestCheckpoint: async () => null,
    };

    const logger = createMockLogger();
    const failingSubscriber = new ExecutionEventRepositorySubscriber(failingRepository, logger);
    const handler = failingSubscriber.createHandler();

    const event = createTestEvent("execution.started");
    await handler(event);

    expect(true).toBe(true);
  });
});
