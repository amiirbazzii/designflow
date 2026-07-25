import type {
  ExecutionEvent,
  ExecutionEventHandler,
  ExecutionEventPublisher,
} from "@designflow/sdk";

// ── In-Memory Event Publisher ──────────────────────────────────

export class InMemoryEventPublisher implements ExecutionEventPublisher {
  private readonly handlers = new Set<ExecutionEventHandler>();

  public async publish(event: ExecutionEvent): Promise<void> {
    const handlers = Array.from(this.handlers);

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch {
        // Subscriber failures MUST NOT break execution
      }
    }
  }

  public subscribe(handler: ExecutionEventHandler): void {
    this.handlers.add(handler);
  }

  public unsubscribe(handler: ExecutionEventHandler): void {
    this.handlers.delete(handler);
  }
}
