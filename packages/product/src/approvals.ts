import { approvalOutcomeSchema, pendingApprovalSchema } from "./schemas";
import type { ApprovalOutcome, ExecutionState, PendingApproval } from "./schemas";
import type { ExecutionEventSource } from "./event-collector";
import { ExecutionNotFoundError } from "./errors";
import type {
  ApprovalManager,
  ExecutionContract,
  ExecutionRecord,
  ExecutionRepository,
} from "@designflow/sdk";
import { DesignFlowError } from "@designflow/sdk";

export class ApprovalNotPendingError extends DesignFlowError {
  public constructor(
    executionId: string,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_NO_PENDING_APPROVAL",
      `Execution is not waiting for approval: ${executionId}`,
      { ...metadata, executionId },
    );
    this.name = "ApprovalNotPendingError";
    Object.setPrototypeOf(this, ApprovalNotPendingError.prototype);
  }
}

export interface ApprovalServiceOptions {
  readonly executionRepository: ExecutionRepository;
  readonly eventSource: ExecutionEventSource;
  readonly approvalManager: ApprovalManager;
  readonly executionContract: ExecutionContract;
}

/**
 * The product-side approval boundary.
 *
 * Holds no approval logic of its own. Deciding an approval and resuming the
 * execution it blocked are engine concerns, owned by `ApprovalManager` and
 * `ExecutionContract`; this translates between an execution id — which is what
 * a person has — and the approval id those interfaces expect, then delegates.
 */
export class ApprovalService {
  private readonly executionRepository: ExecutionRepository;
  private readonly eventSource: ExecutionEventSource;
  private readonly approvalManager: ApprovalManager;
  private readonly executionContract: ExecutionContract;

  public constructor(options: ApprovalServiceOptions) {
    this.executionRepository = options.executionRepository;
    this.eventSource = options.eventSource;
    this.approvalManager = options.approvalManager;
    this.executionContract = options.executionContract;
  }

  /** The approval blocking this execution, or null when none is. */
  public async pendingFor(
    executionId: string,
  ): Promise<PendingApproval | null> {
    const record = await this.requireRecord(executionId);
    const approvalId = await this.findApprovalId(record);

    if (approvalId === null) return null;

    const approval = await this.approvalManager.get(approvalId);
    if (approval === null || approval.status !== "pending") return null;

    return pendingApprovalSchema.parse({
      approvalId: approval.id,
      executionId: approval.executionId,
      workflowId: approval.workflowId,
      reason: approval.reason,
      requestedAt: approval.createdAt,
    });
  }

  public async approve(
    executionId: string,
    comment?: string,
  ): Promise<ApprovalOutcome> {
    return this.decide(executionId, "approve", comment);
  }

  public async reject(
    executionId: string,
    comment?: string,
  ): Promise<ApprovalOutcome> {
    return this.decide(executionId, "reject", comment);
  }

  private async decide(
    executionId: string,
    decision: "approve" | "reject",
    comment?: string,
  ): Promise<ApprovalOutcome> {
    const pending = await this.pendingFor(executionId);

    if (pending === null) {
      throw new ApprovalNotPendingError(executionId, { decision });
    }

    // Record the decision, then let the engine act on it. Both steps belong to
    // the engine's own interfaces; the product layer only sequences them.
    if (decision === "approve") {
      await this.approvalManager.approve(pending.approvalId, comment);
    } else {
      await this.approvalManager.reject(pending.approvalId, comment);
    }

    const result = await this.executionContract.resumeAfterApproval(
      pending.approvalId,
    );

    const state = toState(result.status);

    return approvalOutcomeSchema.parse({
      executionId,
      approvalId: pending.approvalId,
      decision,
      state,
      message: describeOutcome(decision, state, result.error?.message),
    });
  }

  /**
   * The approval id blocking an execution.
   *
   * Prefers the execution record's metadata, which the engine writes when it
   * enters `waiting_approval` and which survives a restart. The event stream is
   * a fallback for a run whose record predates that, or whose metadata was
   * replaced.
   */
  private async findApprovalId(
    record: ExecutionRecord,
  ): Promise<string | null> {
    const fromRecord = record.metadata?.approvalId;
    if (typeof fromRecord === "string" && fromRecord.length > 0) {
      return fromRecord;
    }

    const events = await this.eventSource.listEvents(record.executionId);

    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event?.type !== "execution.waiting_approval") continue;

      const approvalId = event.payload?.approvalId;
      if (typeof approvalId === "string" && approvalId.length > 0) {
        return approvalId;
      }
    }

    return null;
  }

  private async requireRecord(executionId: string): Promise<ExecutionRecord> {
    const record = await this.executionRepository.get(executionId);
    if (record === null) throw new ExecutionNotFoundError(executionId);
    return record;
  }
}

/** Maps the execution contract's terminal status onto a product state. */
export function toState(
  status: "completed" | "failed" | "cancelled" | "pending_approval",
): ExecutionState {
  switch (status) {
    case "completed":
      return "ready";
    case "pending_approval":
      return "needs_approval";
    case "failed":
    case "cancelled":
      return "failed";
  }
}

function describeOutcome(
  decision: "approve" | "reject",
  state: ExecutionState,
  errorMessage: string | undefined,
): string {
  if (decision === "reject") {
    return "Rejected. The workflow was stopped.";
  }

  switch (state) {
    case "ready":
      return "Approved. The workflow finished.";
    case "needs_approval":
      return "Approved. The workflow is waiting on a further approval.";
    case "running":
      return "Approved. The workflow is continuing.";
    case "failed":
      return errorMessage !== undefined
        ? `Approved, but the workflow did not finish: ${errorMessage}`
        : "Approved, but the workflow did not finish.";
  }
}
