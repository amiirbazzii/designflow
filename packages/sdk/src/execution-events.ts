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
  "capability.started",
  "capability.completed",
  "capability.failed",
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
