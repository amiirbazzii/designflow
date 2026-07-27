export const PRODUCT_VERSION = "0.1.0";

// ── Read Model ──────────────────────────────────────────────────
export { InMemoryExecutionEventCollector } from "./event-collector";
export type { ExecutionEventSource } from "./event-collector";

// ── Product API Boundary ────────────────────────────────────────
export { ProductExecutionService, countArtifacts, formatDuration } from "./service";
export type {
  ProductExecutionServiceOptions,
  WorkflowNameResolver,
} from "./service";

// ── Presentation ────────────────────────────────────────────────
export { narrateEvents } from "./narration";
export { buildTimeline } from "./timeline";
export { summarizeArtifacts, classifyArtifacts } from "./artifacts";

// ── Schemas ─────────────────────────────────────────────────────
export {
  executionStateSchema,
  artifactCountsSchema,
  executionOverviewSchema,
  artifactStatusSchema,
  artifactSummarySchema,
  narrationKindSchema,
  narrationEntrySchema,
  timelineEntrySchema,
  executionTimelineSchema,
  executionReportSchema,
} from "./schemas";

export type {
  ExecutionState,
  ArtifactCounts,
  ExecutionOverview,
  ArtifactStatus,
  ArtifactSummary,
  NarrationKind,
  NarrationEntry,
  TimelineEntry,
  ExecutionTimeline,
  ExecutionReport,
} from "./schemas";

// ── Errors ──────────────────────────────────────────────────────
export { ExecutionNotFoundError } from "./errors";
