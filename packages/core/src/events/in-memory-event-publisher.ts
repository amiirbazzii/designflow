import type {
  ExecutionEvent,
  ExecutionEventHandler,
  ExecutionEventPublisher,
  Logger,
} from "@designflow/sdk";

// ── In-Memory Event Publisher ──────────────────────────────────

export class InMemoryEventPublisher implements ExecutionEventPublisher {
  private readonly handlers = new Set<ExecutionEventHandler>();
  private readonly logger: Logger | undefined;

  public constructor(logger?: Logger) {
    this.logger = logger;
  }

  public async publish(event: ExecutionEvent): Promise<void> {
    const handlers = Array.from(this.handlers);

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        if (this.logger !== undefined) {
          this.logger.error(
            "Execution event subscriber failed",
            error instanceof Error ? error : String(error),
          );
        }
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
