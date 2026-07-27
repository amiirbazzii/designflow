import type {
  ExecutionEvent,
  ExecutionEventHandler,
  ExecutionEventPublisher,
} from "@designflow/sdk";

/**
 * Read access to the raw events an execution emitted.
 *
 * The engine's `ExecutionEventRepositorySubscriber` persists only events that
 * map to a lifecycle phase, which drops every `artifact.*` event plus
 * `execution.plan_created` and `execution.reconciled` — exactly the ones that
 * explain what a run reused and changed. The product layer therefore keeps its
 * own record of the stream it subscribes to.
 */
export interface ExecutionEventSource {
  /** Events for one execution, in the order they were published. */
  listEvents(executionId: string): Promise<readonly ExecutionEvent[]>;
}

/**
 * Collects the event stream into memory, per execution.
 *
 * A read model, not a second source of truth: it stores what the engine
 * broadcast and never interprets or acts on it. Losing this store loses
 * presentation detail, never execution state.
 */
export class InMemoryExecutionEventCollector implements ExecutionEventSource {
  private readonly events = new Map<string, ExecutionEvent[]>();

  /** Subscribe this to an `ExecutionEventPublisher` to start collecting. */
  public createHandler(): ExecutionEventHandler {
    return (event: ExecutionEvent): void => {
      const existing = this.events.get(event.executionId);

      if (existing === undefined) {
        this.events.set(event.executionId, [event]);
        return;
      }

      existing.push(event);
    };
  }

  /** Convenience for the common case of collecting everything a publisher emits. */
  public subscribeTo(publisher: ExecutionEventPublisher): void {
    publisher.subscribe(this.createHandler());
  }

  public async listEvents(
    executionId: string,
  ): Promise<readonly ExecutionEvent[]> {
    return [...(this.events.get(executionId) ?? [])];
  }

  /** Drops one execution's events. Presentation detail only. */
  public forget(executionId: string): void {
    this.events.delete(executionId);
  }
}
