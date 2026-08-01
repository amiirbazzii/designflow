// packages/product/src/index.ts
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

// ── Workflow Interaction ────────────────────────────────────────
export { WorkflowRunner } from "./runner";
export type {
  WorkflowRunnerOptions,
  WorkflowStepCountResolver,
} from "./runner";

// ── Worker Task Boundary ────────────────────────────────────────
export {
  WorkerTaskRouter,
  UnknownWorkerError,
  AgentRuntimeUnavailableError,
  workerTaskRequestSchema,
} from "./worker-task";
export type {
  WorkerTaskRequest,
  WorkerTaskResult,
  WorkerTaskRouterOptions,
} from "./worker-task";

// ── Agent Tracing ───────────────────────────────────────────────
export { InMemoryTraceStore, TraceCollector, TraceService } from "./traces";

// ── Agent Sessions ──────────────────────────────────────────────
export { InMemorySessionStore } from "./session-store";
export { buildSessionContext } from "./session-context";
export type {
  SessionContext,
  SessionContextClarification,
  SessionContextOptions,
} from "./session-context";
export { AgentSessionService, SYSTEM_CLOCK } from "./session-service";
export type {
  AgentSessionServiceOptions,
  SessionClock,
  SessionWorkflowStarter,
} from "./session-service";
export {
  SESSION_ERROR_CODES,
  SessionNotFoundError,
  SessionInvalidError,
  SessionStateInvalidError,
  SessionNotWaitingError,
  SessionExpiredError,
  SessionTurnLimitExceededError,
  SessionAnswerInvalidError,
  SessionCancelledError,
  SessionStoreFailedError,
} from "./session-errors";
export type { SessionErrorCode } from "./session-errors";

export { ApprovalService, ApprovalNotPendingError } from "./approvals";
export type { ApprovalServiceOptions } from "./approvals";

export { buildProgress, humanizeCapabilityId, countSkippedSteps } from "./progress";

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

export {
  workflowLaunchRequestSchema,
  executionHandleSchema,
  progressStepStatusSchema,
  progressStepSchema,
  executionProgressSchema,
  pendingApprovalSchema,
  executionStatusSchema,
  approvalOutcomeSchema,
  workflowHistoryEntrySchema,
} from "./schemas";

export type {
  WorkflowLaunchRequest,
  ExecutionHandle,
  ProgressStepStatus,
  ProgressStep,
  ExecutionProgress,
  PendingApproval,
  ExecutionStatus,
  ApprovalOutcome,
  WorkflowHistoryEntry,
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
