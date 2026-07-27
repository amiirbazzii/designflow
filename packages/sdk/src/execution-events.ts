import { z } from "zod";

// ── Event Types ────────────────────────────────────────────────

export const executionEventTypeSchema = z.enum([
  "execution.started",
  "execution.planning",
  "execution.executing",
  "execution.validating",
  "execution.applying",
  "execution.completed",
  "execution.failed",
  "execution.cancelled",
  "execution.policy_denied",
  "execution.waiting_approval",
  "execution.approval_approved",
  "execution.approval_rejected",
  "capability.started",
  "capability.completed",
  "capability.failed",
  "workflow.child_started",
  "workflow.child_completed",
  "workflow.child_failed",
  "artifact.created",
  "artifact.version_created",
  "artifact.relation_added",
  "artifact.impact_analyzed",
  "artifact.diff_created",
  "artifact.reused",
]);

export type ExecutionEventType = z.infer<typeof executionEventTypeSchema>;

// ── Event Schema ───────────────────────────────────────────────

export const executionEventSchema = z.object({
  id: z.string().min(1),
  executionId: z.string().min(1),
  type: executionEventTypeSchema,
  timestamp: z.number(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionEvent = z.infer<typeof executionEventSchema>;

// ── Event Handler ──────────────────────────────────────────────

export type ExecutionEventHandler = (event: ExecutionEvent) => void | Promise<void>;

// ── Event Publisher Interface ──────────────────────────────────

export interface ExecutionEventPublisher {
  publish(event: ExecutionEvent): Promise<void>;
  subscribe(handler: ExecutionEventHandler): void;
  unsubscribe(handler: ExecutionEventHandler): void;
}