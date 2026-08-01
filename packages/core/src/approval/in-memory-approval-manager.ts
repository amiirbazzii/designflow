// packages/core/src/approval/in-memory-approval-manager.ts
import {
  approvalRequestSchema,
  type ApprovalRequest,
  type ApprovalManager,
  DesignFlowError,
} from "@designflow/sdk";

// ── Error ────────────────────────────────────────────────────────

export class ApprovalStateTransitionError extends DesignFlowError {
  public constructor(
    approvalId: string,
    from: string,
    to: string,
  ) {
    super(
      "ERR_APPROVAL_STATE_TRANSITION",
      `Invalid approval state transition: ${from} -> ${to}`,
      { approvalId, from, to },
    );
    this.name = "ApprovalStateTransitionError";
    Object.setPrototypeOf(this, ApprovalStateTransitionError.prototype);
  }
}

export class ApprovalNotFoundError extends DesignFlowError {
  public constructor(approvalId: string) {
    super(
      "ERR_APPROVAL_NOT_FOUND",
      `Approval not found: ${approvalId}`,
      { approvalId },
    );
    this.name = "ApprovalNotFoundError";
    Object.setPrototypeOf(this, ApprovalNotFoundError.prototype);
  }
}

// ── Allowed Transitions ─────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending: new Set(["approved", "rejected"]),
};

function assertValidTransition(
  approvalId: string,
  currentStatus: string,
  targetStatus: string,
): void {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];

  if (allowed === undefined || !allowed.has(targetStatus)) {
    throw new ApprovalStateTransitionError(approvalId, currentStatus, targetStatus);
  }
}

// ── InMemoryApprovalManager ─────────────────────────────────────

export class InMemoryApprovalManager implements ApprovalManager {
  private readonly requests: Map<string, ApprovalRequest> = new Map();

  public async createRequest(
    executionId: string,
    workflowId: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      executionId,
      workflowId,
      status: "pending",
      reason,
      createdAt: Date.now(),
    };

    const validated = approvalRequestSchema.parse(request);
    this.requests.set(validated.id, validated);
    return validated;
  }

  public async approve(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.get(approvalId);

    if (request === null) {
      throw new ApprovalNotFoundError(approvalId);
    }

    assertValidTransition(approvalId, request.status, "approved");

    const updated: ApprovalRequest = {
      ...request,
      status: "approved",
      resolvedAt: Date.now(),
      metadata: {
        ...request.metadata,
        ...(comment !== undefined ? { comment } : {}),
      },
    };

    const validated = approvalRequestSchema.parse(updated);
    this.requests.set(approvalId, validated);
    return validated;
  }

  public async reject(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.get(approvalId);

    if (request === null) {
      throw new ApprovalNotFoundError(approvalId);
    }

    assertValidTransition(approvalId, request.status, "rejected");

    const updated: ApprovalRequest = {
      ...request,
      status: "rejected",
      resolvedAt: Date.now(),
      metadata: {
        ...request.metadata,
        ...(comment !== undefined ? { comment } : {}),
      },
    };

    const validated = approvalRequestSchema.parse(updated);
    this.requests.set(approvalId, validated);
    return validated;
  }

  public async get(approvalId: string): Promise<ApprovalRequest | null> {
    const raw = this.requests.get(approvalId);

    if (raw === undefined) return null;

    return approvalRequestSchema.parse(raw);
  }
}