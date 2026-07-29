// packages/product/src/runner.ts
import {
  executionHandleSchema,
  executionStatusSchema,
  workflowHistoryEntrySchema,
  workflowLaunchRequestSchema,
} from "./schemas";
import type {
  ApprovalOutcome,
  ExecutionHandle,
  ExecutionProgress,
  ExecutionReport,
  ExecutionState,
  ExecutionStatus,
  PendingApproval,
  WorkflowHistoryEntry,
  WorkflowLaunchRequest,
} from "./schemas";
import { ProductExecutionService } from "./service";
import type { WorkflowNameResolver } from "./service";
import type { ExecutionEventSource } from "./event-collector";
import { buildProgress } from "./progress";
import { ApprovalService, toState } from "./approvals";
import { ExecutionNotFoundError } from "./errors";
import type {
  ApprovalManager,
  ArtifactRegistry,
  ExecutionContract,
  ExecutionRepository,
} from "@designflow/sdk";

/** Number of steps a workflow declares, when the caller can resolve it. */
export type WorkflowStepCountResolver = (
  workflowId: string,
) => number | undefined | Promise<number | undefined>;

export interface WorkflowRunnerOptions {
  readonly executionContract: ExecutionContract;
  readonly executionRepository: ExecutionRepository;
  readonly eventSource: ExecutionEventSource;
  readonly artifactRegistry?: ArtifactRegistry | undefined;
  readonly approvalManager?: ApprovalManager | undefined;
  readonly resolveWorkflowName?: WorkflowNameResolver | undefined;
  /**
   * Lets progress report a denominator before every step has been seen.
   * Without it, `total` grows as steps are observed.
   */
  readonly resolveWorkflowStepCount?: WorkflowStepCountResolver | undefined;
}

/**
 * The product layer's interaction surface.
 *
 * One object a UI, HTTP API or CLI can hold: start work, watch it, approve it,
 * and look back at it. Callers construct no `ExecutionContext`, touch no
 * repository or publisher, and never import `@designflow/core`.
 *
 * It owns no execution state and re-implements nothing. Launching delegates to
 * `ExecutionContract`, approving delegates to `ApprovalManager`, and every
 * read is a projection of what the engine already recorded, built on the
 * Stage 27 `ProductExecutionService`.
 */
export class WorkflowRunner {
  private readonly executionContract: ExecutionContract;
  private readonly executionRepository: ExecutionRepository;
  private readonly eventSource: ExecutionEventSource;
  private readonly product: ProductExecutionService;
  private readonly approvals: ApprovalService | undefined;
  private readonly resolveWorkflowName: WorkflowNameResolver | undefined;
  private readonly resolveWorkflowStepCount:
    | WorkflowStepCountResolver
    | undefined;

  public constructor(options: WorkflowRunnerOptions) {
    this.executionContract = options.executionContract;
    this.executionRepository = options.executionRepository;
    this.eventSource = options.eventSource;
    this.resolveWorkflowName = options.resolveWorkflowName;
    this.resolveWorkflowStepCount = options.resolveWorkflowStepCount;

    this.product = new ProductExecutionService({
      executionRepository: options.executionRepository,
      eventSource: options.eventSource,
      artifactRegistry: options.artifactRegistry,
      resolveWorkflowName: options.resolveWorkflowName,
    });

    this.approvals =
      options.approvalManager !== undefined
        ? new ApprovalService({
            executionRepository: options.executionRepository,
            eventSource: options.eventSource,
            approvalManager: options.approvalManager,
            executionContract: options.executionContract,
          })
        : undefined;
  }

  // ── Launch ────────────────────────────────────────────────────

  /**
   * Starts a workflow and returns a handle to it.
   *
   * The promise settles when the engine's execution contract settles, which is
   * when the run reaches a terminal state or blocks on an approval — the
   * contract allocates an execution id only on return, so there is no earlier
   * moment at which a handle could be produced. `state` therefore reports what
   * actually happened, not an optimistic "running".
   *
   * A failed run is reported through the handle's state, not by throwing: a
   * workflow that ran and failed is an outcome to display, not an error in the
   * act of launching.
   */
  public async start(request: WorkflowLaunchRequest): Promise<ExecutionHandle> {
    const validated = workflowLaunchRequestSchema.parse(request);

    const result = await this.executionContract.execute({
      workflowId: validated.workflowId,
      ...(validated.input !== undefined ? { input: validated.input } : {}),
      ...(validated.metadata !== undefined
        ? { metadata: validated.metadata }
        : {}),
    });

    return executionHandleSchema.parse({
      executionId: result.executionId,
      workflowId: result.workflowId,
      workflowName: await this.nameOf(result.workflowId),
      state: toState(result.status),
    });
  }

  // ── Watch ─────────────────────────────────────────────────────

  /** Answers "what is happening right now?". */
  public async status(executionId: string): Promise<ExecutionStatus> {
    const overview = await this.product.getOverview(executionId);
    const progress = await this.progress(executionId);
    const approval = await this.pendingApproval(executionId);

    return executionStatusSchema.parse({
      executionId: overview.executionId,
      workflowId: overview.workflowId,
      workflowName: overview.workflowName,
      state: overview.state,
      statusLabel: overview.statusLabel,
      ...(progress.currentStep !== undefined
        ? { currentStep: progress.currentStep }
        : {}),
      progress,
      message: statusMessage(overview.state, progress, approval, overview.summary),
      ...(approval !== null ? { approval } : {}),
    });
  }

  /** The step-by-step view, for rendering a checklist. */
  public async progress(executionId: string): Promise<ExecutionProgress> {
    const record = await this.executionRepository.get(executionId);
    if (record === null) throw new ExecutionNotFoundError(executionId);

    const events = await this.eventSource.listEvents(executionId);
    const declared = await this.resolveWorkflowStepCount?.(record.workflowId);

    return buildProgress(events, declared);
  }

  /** The full Stage 27 report: overview, narration, timeline, artifacts. */
  public async explain(executionId: string): Promise<ExecutionReport> {
    return this.product.getReport(executionId);
  }

  // ── Approve ───────────────────────────────────────────────────

  /** The approval blocking this execution, or null when none is. */
  public async pendingApproval(
    executionId: string,
  ): Promise<PendingApproval | null> {
    if (this.approvals === undefined) return null;
    return this.approvals.pendingFor(executionId);
  }

  public async approve(
    executionId: string,
    comment?: string,
  ): Promise<ApprovalOutcome> {
    return this.requireApprovals().approve(executionId, comment);
  }

  public async reject(
    executionId: string,
    comment?: string,
  ): Promise<ApprovalOutcome> {
    return this.requireApprovals().reject(executionId, comment);
  }

  // ── Look back ─────────────────────────────────────────────────

  /**
   * Answers "what have I run?", most recent first.
   *
   * Omit `workflowId` for everything. A caller browsing history has an
   * execution list, not a workflow in mind, and making them supply one meant
   * every consumer reimplemented the same fan-out over the repository.
   */
  public async history(
    workflowId?: string,
  ): Promise<readonly WorkflowHistoryEntry[]> {
    const overviews =
      workflowId !== undefined
        ? await this.product.listOverviews(workflowId)
        : await this.product.listAllOverviews();

    return overviews.map((overview) =>
      workflowHistoryEntrySchema.parse({
        executionId: overview.executionId,
        workflowId: overview.workflowId,
        workflowName: overview.workflowName,
        status: overview.status,
        state: overview.state,
        summary: overview.summary,
        startedAt: overview.startedAt,
        ...(overview.completedAt !== undefined
          ? { completedAt: overview.completedAt }
          : {}),
        ...(overview.durationMs !== undefined
          ? { durationMs: overview.durationMs }
          : {}),
        ...(overview.durationLabel !== undefined
          ? { durationLabel: overview.durationLabel }
          : {}),
      }),
    );
  }

  // ── Internals ─────────────────────────────────────────────────

  private requireApprovals(): ApprovalService {
    if (this.approvals === undefined) {
      throw new ExecutionNotFoundError("approval-manager", {
        detail: "No ApprovalManager was configured on this WorkflowRunner",
      });
    }

    return this.approvals;
  }

  private async nameOf(workflowId: string): Promise<string> {
    return (await this.resolveWorkflowName?.(workflowId)) ?? workflowId;
  }
}

/** The one line a person reads to know where things stand. */
function statusMessage(
  state: ExecutionState,
  progress: ExecutionProgress,
  approval: PendingApproval | null,
  summary: string,
): string {
  if (state === "needs_approval") {
    return approval !== null
      ? `Needs your approval — ${approval.reason}`
      : "Needs your approval.";
  }

  if (state === "running") {
    const counted =
      progress.total > 0
        ? ` (${progress.completed} of ${progress.total})`
        : "";

    return progress.currentStep !== undefined
      ? `${progress.currentStep}${counted}`
      : `Running${counted}`;
  }

  return summary;
}
