import { describe, expect, test } from "bun:test";
import { InMemoryEventPublisher } from "./in-memory-event-publisher";
import type { ExecutionEvent, ExecutionEventHandler } from "@designflow/sdk";

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

// ── Tests ───────────────────────────────────────────────────────

describe("InMemoryEventPublisher", () => {
  test("publish delivers event to subscribers", async () => {
    const publisher = new InMemoryEventPublisher();
    const received: ExecutionEvent[] = [];

    publisher.subscribe((event) => {
      received.push(event);
    });

    const event = createTestEvent("execution.started");
    await publisher.publish(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  test("publish delivers to multiple subscribers", async () => {
    const publisher = new InMemoryEventPublisher();
    const received1: ExecutionEvent[] = [];
    const received2: ExecutionEvent[] = [];

    publisher.subscribe((event) => {
      received1.push(event);
    });

    publisher.subscribe((event) => {
      received2.push(event);
    });

    const event = createTestEvent("execution.completed");
    await publisher.publish(event);

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  test("unsubscribe stops delivery", async () => {
    const publisher = new InMemoryEventPublisher();
    const received: ExecutionEvent[] = [];

    const handler: ExecutionEventHandler = (event) => {
      received.push(event);
    };

    publisher.subscribe(handler);
    publisher.unsubscribe(handler);

    const event = createTestEvent("execution.failed");
    await publisher.publish(event);

    expect(received).toHaveLength(0);
  });

  test("subscriber failure does not break publish", async () => {
    const publisher = new InMemoryEventPublisher();
    const received: ExecutionEvent[] = [];

    publisher.subscribe(() => {
      throw new Error("Subscriber error");
    });

    publisher.subscribe((event) => {
      received.push(event);
    });

    const event = createTestEvent("execution.started");
    await publisher.publish(event);

    expect(received).toHaveLength(1);
  });

  test("async subscriber failure does not break publish", async () => {
    const publisher = new InMemoryEventPublisher();
    const received: ExecutionEvent[] = [];

    publisher.subscribe(async () => {
      throw new Error("Async subscriber error");
    });

    publisher.subscribe((event) => {
      received.push(event);
    });

    const event = createTestEvent("capability.started");
    await publisher.publish(event);

    expect(received).toHaveLength(1);
  });

  test("publish with no subscribers does not throw", async () => {
    const publisher = new InMemoryEventPublisher();

    const event = createTestEvent("execution.planning");
    await publisher.publish(event);
  });

  test("unsubscribe non-existent handler does not throw", () => {
    const publisher = new InMemoryEventPublisher();

    const handler: ExecutionEventHandler = () => {};
    publisher.unsubscribe(handler);
  });
});
