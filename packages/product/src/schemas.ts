import { z } from "zod";

/**
 * Product-facing read models.
 *
 * Every shape here is derived from what the engine already publishes —
 * execution records, checkpoints, the event stream, the artifact registry and
 * reconciliation reports. Nothing here is authoritative: if a value disagrees
 * with the engine, the engine is right and this layer has a bug.
 */

// ── Execution State ──────────────────────────────────────────────

/**
 * What a person needs to know about an execution right now, as distinct from
 * the engine's `ExecutionRecordStatus`, which also encodes how it got there.
 */
export const executionStateSchema = z.enum([
  /** Finished, artifacts are usable. */
  "ready",
  /** Still working. */
  "running",
  /** Blocked on a person. */
  "needs_approval",
  /** Stopped without producing a usable result. */
  "failed",
]);

export type ExecutionState = z.infer<typeof executionStateSchema>;

// ── Artifact Counts ──────────────────────────────────────────────

export const artifactCountsSchema = z.object({
  created: z.number().int().nonnegative(),
  reused: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type ArtifactCounts = z.infer<typeof artifactCountsSchema>;

// ── Execution Overview ───────────────────────────────────────────

export const executionOverviewSchema = z.object({
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  /** Display name when the caller supplied one, else the workflow id. */
  workflowName: z.string().min(1),
  status: z.string().min(1),
  /** Title-cased status for display, e.g. "Completed". */
  statusLabel: z.string().min(1),
  state: executionStateSchema,
  startedAt: z.number(),
  completedAt: z.number().optional(),
  durationMs: z.number().nonnegative().optional(),
  /** Human phrasing of the duration, e.g. "42 seconds". */
  durationLabel: z.string().optional(),
  artifacts: artifactCountsSchema,
  /** One sentence answering "what happened?". */
  summary: z.string().min(1),
  /** Present when the execution stopped on an error. */
  failureReason: z.string().optional(),
});

export type ExecutionOverview = z.infer<typeof executionOverviewSchema>;

// ── Artifact Presentation ────────────────────────────────────────

export const artifactStatusSchema = z.enum([
  "created",
  "reused",
  "removed",
  "unchanged",
]);

export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

export const artifactSummarySchema = z.object({
  artifactId: z.string().min(1),
  /** `metadata.name` when the producer supplied one, else the id. */
  name: z.string().min(1),
  type: z.string().min(1),
  version: z.number().int().positive().optional(),
  status: artifactStatusSchema,
  /** The capability that produced it, from provenance. */
  createdBy: z.string().min(1).optional(),
  /** Names of the artifacts it was built from, nearest first. */
  dependencies: z.array(z.string().min(1)),
});

export type ArtifactSummary = z.infer<typeof artifactSummarySchema>;

// ── Narration ────────────────────────────────────────────────────

export const narrationKindSchema = z.enum([
  "lifecycle",
  "planning",
  "artifact",
  "approval",
  "reconciliation",
  "failure",
]);

export type NarrationKind = z.infer<typeof narrationKindSchema>;

/** One line of the story, translated from one or more raw events. */
export const narrationEntrySchema = z.object({
  timestamp: z.number(),
  kind: narrationKindSchema,
  /** The sentence to show, e.g. "Reused 8 existing artifacts". */
  message: z.string().min(1),
  /** Raw event types this line was derived from. */
  sourceEventTypes: z.array(z.string().min(1)),
});

export type NarrationEntry = z.infer<typeof narrationEntrySchema>;

// ── Timeline ─────────────────────────────────────────────────────

export const timelineEntrySchema = z.object({
  timestamp: z.number(),
  /** Wall-clock label in UTC, e.g. "10:04". */
  at: z.string().min(1),
  /** Milliseconds since the execution started. */
  offsetMs: z.number().nonnegative(),
  kind: narrationKindSchema,
  label: z.string().min(1),
});

export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const executionTimelineSchema = z.object({
  executionId: z.string().min(1),
  startedAt: z.number(),
  entries: z.array(timelineEntrySchema),
});

export type ExecutionTimeline = z.infer<typeof executionTimelineSchema>;

// ── Full Report ──────────────────────────────────────────────────

/**
 * Everything the product layer can say about one execution.
 *
 * This is the shape that answers "why did this workflow produce this result?".
 */
export const executionReportSchema = z.object({
  overview: executionOverviewSchema,
  narration: z.array(narrationEntrySchema),
  timeline: executionTimelineSchema,
  artifacts: z.array(artifactSummarySchema),
});

export type ExecutionReport = z.infer<typeof executionReportSchema>;
