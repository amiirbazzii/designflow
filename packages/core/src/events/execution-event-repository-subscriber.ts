import type {
  ExecutionEvent,
  ExecutionEventHandler,
  ExecutionEventType,
  ExecutionRepository,
  LifecycleEventPhase,
  Logger,
} from "@designflow/sdk";
import { lifecycleEventSchema } from "@designflow/sdk";

// ── Event Type to Lifecycle Phase Mapping ───────────────────────

const EVENT_TO_PHASE: Partial<
  Record<ExecutionEventType, LifecycleEventPhase>
> = {
  "execution.started": "created",
  "execution.planning": "planning",
  "execution.executing": "executing",
  "execution.validating": "validating",
  "execution.applying": "applying",
  "execution.completed": "completed",
  "execution.failed": "failed",
  "execution.cancelled": "failed",
  "execution.policy_denied": "failed",
  "execution.waiting_approval": "waiting_approval",
  "execution.approval_approved": "approval_approved",
  "execution.approval_rejected": "approval_rejected",
  "workflow.child_started": "executing",
  "workflow.child_completed": "executing",
  "workflow.child_failed": "failed",
};

// ── Execution Event Repository Subscriber ──────────────────────

export class ExecutionEventRepositorySubscriber {
  private readonly repository: ExecutionRepository;
  private readonly logger: Logger | undefined;

  public constructor(repository: ExecutionRepository, logger?: Logger) {
    this.repository = repository;
    this.logger = logger;
  }

  public createHandler(): ExecutionEventHandler {
    return async (event: ExecutionEvent): Promise<void> => {
      const phase = EVENT_TO_PHASE[event.type];

      if (phase === undefined) {
        return;
      }

      try {
        const lifecycleEvent = lifecycleEventSchema.parse({
          executionId: event.executionId,
          phase,
          timestamp: event.timestamp,
          metadata: {
            eventType: event.type,
            eventId: event.id,
            payload: event.payload,
          },
        });

        await this.repository.appendEvent(lifecycleEvent);
      } catch (error) {
        if (this.logger !== undefined) {
          this.logger.error(
            "Failed to persist execution event",
            error instanceof Error ? error : String(error),
          );
        }
      }
    };
  }
}