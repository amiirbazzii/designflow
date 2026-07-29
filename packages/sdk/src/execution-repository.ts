// packages/sdk/src/execution-repository.ts
import { z } from "zod";

// ── Schemas ──────────────────────────────────────────────────────

export const executionRecordStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
  "waiting_approval",
]);

export type ExecutionRecordStatus = z.infer<typeof executionRecordStatusSchema>;

export const executionRecordSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  status: executionRecordStatusSchema,
  startedAt: z.number(),
  completedAt: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export const lifecycleEventPhaseSchema = z.enum([
  "created",
  "planning",
  "executing",
  "validating",
  "applying",
  "waiting_approval",
  "approval_approved",
  "approval_rejected",
  "completed",
  "failed",
]);

export type LifecycleEventPhase = z.infer<typeof lifecycleEventPhaseSchema>;

export const lifecycleEventSchema = z.object({
  executionId: z.string().min(1),
  phase: lifecycleEventPhaseSchema,
  timestamp: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;

export const executionCheckpointDataSchema = z.object({
  executionId: z.string().min(1),
  phase: z.string().min(1),
  timestamp: z.number(),
  state: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExecutionCheckpointData = z.infer<typeof executionCheckpointDataSchema>;

// ── Repository Interface ─────────────────────────────────────────

export interface ExecutionRepository {
  create(record: ExecutionRecord): Promise<void>;
  update(executionId: string, patch: Partial<Omit<ExecutionRecord, "executionId">>): Promise<void>;
  get(executionId: string): Promise<ExecutionRecord | null>;
  list(workflowId: string): Promise<readonly ExecutionRecord[]>;

  /**
   * Every execution, newest first, across all workflows.
   *
   * Optional so that adding it breaks no existing implementation. A consumer
   * that needs "everything I have run" has no other way to ask: `list`
   * requires a workflow id, which a caller browsing history does not have.
   */
  listAll?(limit?: number): Promise<readonly ExecutionRecord[]>;

  appendEvent(event: LifecycleEvent): Promise<void>;
  listEvents(executionId: string): Promise<readonly LifecycleEvent[]>;

  saveCheckpoint(executionId: string, checkpoint: ExecutionCheckpointData): Promise<void>;
  getLatestCheckpoint(executionId: string): Promise<ExecutionCheckpointData | null>;
}