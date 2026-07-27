import {
  artifactCountsSchema,
  executionOverviewSchema,
  executionReportSchema,
} from "./schemas";
import type {
  ArtifactCounts,
  ArtifactSummary,
  ExecutionOverview,
  ExecutionReport,
  ExecutionState,
  ExecutionTimeline,
  NarrationEntry,
} from "./schemas";
import type { ExecutionEventSource } from "./event-collector";
import { narrateEvents } from "./narration";
import { buildTimeline } from "./timeline";
import { summarizeArtifacts } from "./artifacts";
import { ExecutionNotFoundError } from "./errors";
import type {
  ArtifactRegistry,
  ExecutionEvent,
  ExecutionRecord,
  ExecutionRepository,
} from "@designflow/sdk";

/** Resolves a workflow's display name. Falls back to the id when absent. */
export type WorkflowNameResolver = (
  workflowId: string,
) => string | undefined | Promise<string | undefined>;

export interface ProductExecutionServiceOptions {
  readonly executionRepository: ExecutionRepository;
  readonly eventSource: ExecutionEventSource;
  /**
   * Enables artifact summaries. Without it the counts still resolve, but
   * individual artifacts cannot be described.
   */
  readonly artifactRegistry?: ArtifactRegistry | undefined;
  readonly resolveWorkflowName?: WorkflowNameResolver | undefined;
}

/**
 * The product layer's read API.
 *
 * The single boundary between the engine and anything user-facing — a UI, an
 * HTTP API or the CLI reads executions through this and never inspects engine
 * internals. Everything it returns is derived from what the engine already
 * records: execution records, the event stream, the artifact registry and
 * reconciliation reports. It holds no execution state and performs no work.
 */
export class ProductExecutionService {
  private readonly executionRepository: ExecutionRepository;
  private readonly eventSource: ExecutionEventSource;
  private readonly artifactRegistry: ArtifactRegistry | undefined;
  private readonly resolveWorkflowName: WorkflowNameResolver | undefined;

  public constructor(options: ProductExecutionServiceOptions) {
    this.executionRepository = options.executionRepository;
    this.eventSource = options.eventSource;
    this.artifactRegistry = options.artifactRegistry;
    this.resolveWorkflowName = options.resolveWorkflowName;
  }

  /** Answers "what is this run, and how did it go?". */
  public async getOverview(executionId: string): Promise<ExecutionOverview> {
    const record = await this.requireRecord(executionId);
    const events = await this.eventSource.listEvents(executionId);

    const workflowName =
      (await this.resolveWorkflowName?.(record.workflowId)) ??
      record.workflowId;

    const state = toState(record);
    const artifacts = countArtifacts(events);
    const durationMs = durationOf(record);

    return executionOverviewSchema.parse({
      executionId: record.executionId,
      workflowId: record.workflowId,
      workflowName,
      status: record.status,
      statusLabel: labelOf(record.status),
      state,
      startedAt: record.startedAt,
      ...(record.completedAt !== undefined
        ? { completedAt: record.completedAt }
        : {}),
      ...(durationMs !== undefined
        ? { durationMs, durationLabel: formatDuration(durationMs) }
        : {}),
      artifacts,
      summary: summarize(workflowName, state, artifacts),
      ...(failureReasonOf(events) !== undefined
        ? { failureReason: failureReasonOf(events) }
        : {}),
    });
  }

  /** Answers "what happened, in words?". */
  public async getNarration(
    executionId: string,
  ): Promise<readonly NarrationEntry[]> {
    await this.requireRecord(executionId);
    return narrateEvents(await this.eventSource.listEvents(executionId));
  }

  /** Answers "what happened, and when?". */
  public async getTimeline(executionId: string): Promise<ExecutionTimeline> {
    const record = await this.requireRecord(executionId);
    const events = await this.eventSource.listEvents(executionId);

    return buildTimeline(executionId, record.startedAt, narrateEvents(events));
  }

  /** Answers "what did it create, reuse and drop?". */
  public async getArtifacts(
    executionId: string,
  ): Promise<readonly ArtifactSummary[]> {
    await this.requireRecord(executionId);

    if (this.artifactRegistry === undefined) return [];

    return summarizeArtifacts(
      this.artifactRegistry,
      await this.eventSource.listEvents(executionId),
    );
  }

  /**
   * Everything at once — the shape that answers "why did this workflow produce
   * this result?".
   */
  public async getReport(executionId: string): Promise<ExecutionReport> {
    const record = await this.requireRecord(executionId);
    const events = await this.eventSource.listEvents(executionId);
    const narration = narrateEvents(events);

    return executionReportSchema.parse({
      overview: await this.getOverview(executionId),
      narration,
      timeline: buildTimeline(executionId, record.startedAt, narration),
      artifacts: await this.getArtifacts(executionId),
    });
  }

  /** Overviews for a workflow's executions, most recent first. */
  public async listOverviews(
    workflowId: string,
  ): Promise<readonly ExecutionOverview[]> {
    const records = await this.executionRepository.list(workflowId);

    const sorted = [...records].sort(
      (left, right) => right.startedAt - left.startedAt,
    );

    const overviews: ExecutionOverview[] = [];
    for (const record of sorted) {
      overviews.push(await this.getOverview(record.executionId));
    }

    return overviews;
  }

  private async requireRecord(executionId: string): Promise<ExecutionRecord> {
    const record = await this.executionRepository.get(executionId);

    if (record === null) {
      throw new ExecutionNotFoundError(executionId);
    }

    return record;
  }
}

// ── Derivations ─────────────────────────────────────────────────

/**
 * Collapses the engine's status into what a person needs to act on.
 *
 * `cancelled` reads as `failed`: from a user's point of view both mean the run
 * stopped without producing a usable result.
 */
function toState(record: ExecutionRecord): ExecutionState {
  switch (record.status) {
    case "completed":
      return "ready";
    case "running":
      return "running";
    case "waiting_approval":
      return "needs_approval";
    case "failed":
    case "cancelled":
      return "failed";
  }
}

function labelOf(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function durationOf(record: ExecutionRecord): number | undefined {
  if (record.completedAt === undefined) return undefined;
  return Math.max(0, record.completedAt - record.startedAt);
}

/** Human phrasing, coarsened deliberately — nobody reads "42134 ms". */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;

  const totalSeconds = Math.round(durationMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds} ${totalSeconds === 1 ? "second" : "seconds"}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minuteLabel = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  if (seconds === 0) return minuteLabel;

  return `${minuteLabel} ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

/**
 * Artifact counts for the run.
 *
 * The reconciliation report is preferred when present — it is the engine's own
 * accounting and already distinguishes unchanged from added. Without it (a
 * non-incremental run) the counts fall back to the artifact events, where
 * "unchanged" has no meaning and stays zero.
 */
export function countArtifacts(
  events: readonly ExecutionEvent[],
): ArtifactCounts {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== "execution.reconciled") continue;

    const created = readCount(event, "added");
    const reused = readCount(event, "reused");
    const removed = readCount(event, "removed");
    const unchanged = readCount(event, "unchanged");

    return artifactCountsSchema.parse({
      created,
      reused,
      removed,
      unchanged,
      total: created + reused + unchanged,
    });
  }

  const createdIds = new Set<string>();
  const reusedIds = new Set<string>();

  for (const event of events) {
    const artifactId = event.payload?.artifactId;
    if (typeof artifactId !== "string") continue;

    if (event.type === "artifact.reused") {
      reusedIds.add(artifactId);
      createdIds.delete(artifactId);
    } else if (event.type === "artifact.created" && !reusedIds.has(artifactId)) {
      createdIds.add(artifactId);
    }
  }

  return artifactCountsSchema.parse({
    created: createdIds.size,
    reused: reusedIds.size,
    removed: 0,
    unchanged: 0,
    total: createdIds.size + reusedIds.size,
  });
}

function readCount(event: ExecutionEvent, key: string): number {
  const value = event.payload?.[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

function failureReasonOf(
  events: readonly ExecutionEvent[],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type !== "execution.failed") continue;

    const reason = event.payload?.reason ?? event.payload?.error;
    if (typeof reason === "string" && reason.length > 0) return reason;

    const failedSteps = event.payload?.failedSteps;
    if (Array.isArray(failedSteps) && failedSteps.length > 0) {
      return `Failed at ${failedSteps.filter((step) => typeof step === "string").join(", ")}`;
    }

    return "Execution failed";
  }

  return undefined;
}

/** The one-sentence answer to "what happened?". */
function summarize(
  workflowName: string,
  state: ExecutionState,
  artifacts: ArtifactCounts,
): string {
  switch (state) {
    case "running":
      return `${workflowName} is running.`;

    case "needs_approval":
      return `${workflowName} is waiting for your approval.`;

    case "failed":
      return `${workflowName} did not finish.`;

    case "ready": {
      const parts: string[] = [];
      if (artifacts.created > 0) parts.push(`created ${artifacts.created}`);
      if (artifacts.reused > 0) parts.push(`reused ${artifacts.reused}`);
      if (artifacts.unchanged > 0) {
        parts.push(`left ${artifacts.unchanged} unchanged`);
      }
      if (artifacts.removed > 0) parts.push(`removed ${artifacts.removed}`);

      return parts.length > 0
        ? `${workflowName} finished — ${parts.join(", ")} artifacts.`
        : `${workflowName} finished.`;
    }
  }
}
