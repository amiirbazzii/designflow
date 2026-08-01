// packages/storage-sqlite/src/approval-manager.ts
import type { Database } from "bun:sqlite";
import {
  DesignFlowError,
  approvalRequestSchema,
  isApprovalExpired,
  DEFAULT_APPROVAL_EXPIRATION_MS,
  type ApprovalManager,
  type ApprovalRequest,
} from "@designflow/sdk";
import { asRow } from "./execution-repository";
import { fromJsonRecord, toJson } from "./schema";

export class ApprovalNotFoundError extends DesignFlowError {
  public constructor(approvalId: string) {
    super("ERR_APPROVAL_NOT_FOUND", `Approval not found: ${approvalId}`, {
      approvalId,
    });
    this.name = "ApprovalNotFoundError";
    Object.setPrototypeOf(this, ApprovalNotFoundError.prototype);
  }
}

export class ApprovalStateTransitionError extends DesignFlowError {
  public constructor(approvalId: string, from: string, to: string) {
    super(
      "ERR_APPROVAL_STATE_TRANSITION",
      `Approval ${approvalId} is already ${from} and cannot become ${to}`,
      { approvalId, from, to },
    );
    this.name = "ApprovalStateTransitionError";
    Object.setPrototypeOf(this, ApprovalStateTransitionError.prototype);
  }
}

/** The request's `expiresAt` has passed. It can no longer authorize or refuse execution. */
export class ApprovalExpiredError extends DesignFlowError {
  public constructor(approvalId: string) {
    super("ERR_APPROVAL_EXPIRED", `Approval ${approvalId} has expired`, { approvalId });
    this.name = "ApprovalExpiredError";
    Object.setPrototypeOf(this, ApprovalExpiredError.prototype);
  }
}

/**
 * `ApprovalManager` backed by SQLite.
 *
 * A decision has to outlive the process that asked for it — a person may
 * answer an approval hours later, from a different session. That is the whole
 * reason approvals are persisted rather than kept beside the run.
 *
 * Only `pending` may transition. Re-deciding a settled approval is refused
 * rather than silently overwritten, so a double-clicked button cannot flip a
 * rejection into an approval.
 */
export class SqliteApprovalManager implements ApprovalManager {
  private readonly db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  public async createRequest(
    executionId: string,
    workflowId: string,
    reason: string,
    expiresAt?: number,
  ): Promise<ApprovalRequest> {
    const now = Date.now();
    const request = approvalRequestSchema.parse({
      id: crypto.randomUUID(),
      executionId,
      workflowId,
      status: "pending",
      reason,
      createdAt: now,
      expiresAt: expiresAt ?? now + DEFAULT_APPROVAL_EXPIRATION_MS,
    });

    this.db
      .query(
        `INSERT INTO approvals
           (approval_id, execution_id, workflow_id, status, reason, created_at, resolved_at, expires_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.id,
        request.executionId,
        request.workflowId,
        request.status,
        request.reason,
        request.createdAt,
        null,
        request.expiresAt ?? null,
        null,
      );

    return request;
  }

  public async approve(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    return this.settle(approvalId, "approved", comment);
  }

  public async reject(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    return this.settle(approvalId, "rejected", comment);
  }

  public async get(approvalId: string): Promise<ApprovalRequest | null> {
    const row = this.db
      .query("SELECT * FROM approvals WHERE approval_id = ?")
      .get(approvalId);

    return row === null ? null : toApproval(row);
  }

  /** The approval blocking an execution, if one is. */
  public async findPending(
    executionId: string,
  ): Promise<ApprovalRequest | null> {
    const row = this.db
      .query(
        `SELECT * FROM approvals
         WHERE execution_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(executionId);

    return row === null ? null : toApproval(row);
  }

  /**
   * Persists `expired` onto every still-`pending` request whose `expiresAt`
   * has passed. Not part of `ApprovalManager` — a cleanup concern, exercised
   * by `designflow cleanup`, never by the approval flow itself. Idempotent:
   * a request already settled or already `expired` is skipped.
   */
  public async expireStale(nowMs: number): Promise<readonly ApprovalRequest[]> {
    const rows = this.db
      .query("SELECT * FROM approvals WHERE status = 'pending'")
      .all();

    const expired: ApprovalRequest[] = [];

    for (const row of rows) {
      const approval = toApproval(row);
      if (!isApprovalExpired(approval, nowMs)) continue;

      this.db
        .query(`UPDATE approvals SET status = 'expired', resolved_at = ? WHERE approval_id = ?`)
        .run(nowMs, approval.id);

      expired.push(approvalRequestSchema.parse({ ...approval, status: "expired", resolvedAt: nowMs }));
    }

    return expired;
  }

  private async settle(
    approvalId: string,
    status: "approved" | "rejected",
    comment: string | undefined,
  ): Promise<ApprovalRequest> {
    const existing = await this.get(approvalId);

    if (existing === null) throw new ApprovalNotFoundError(approvalId);

    if (isApprovalExpired(existing, Date.now())) throw new ApprovalExpiredError(approvalId);

    if (existing.status !== "pending") {
      throw new ApprovalStateTransitionError(
        approvalId,
        existing.status,
        status,
      );
    }

    const resolvedAt = Date.now();
    const metadata = comment !== undefined ? { comment } : undefined;

    this.db
      .query(
        `UPDATE approvals
         SET status = ?, resolved_at = ?, metadata_json = ?
         WHERE approval_id = ?`,
      )
      .run(status, resolvedAt, toJson(metadata), approvalId);

    return approvalRequestSchema.parse({
      ...existing,
      status,
      resolvedAt,
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }
}

function toApproval(row: unknown): ApprovalRequest {
  const record = asRow(row);

  return approvalRequestSchema.parse({
    id: record.approval_id,
    executionId: record.execution_id,
    workflowId: record.workflow_id,
    status: record.status,
    reason: record.reason,
    createdAt: record.created_at,
    ...(record.resolved_at !== null && record.resolved_at !== undefined
      ? { resolvedAt: record.resolved_at }
      : {}),
    ...(record.expires_at !== null && record.expires_at !== undefined
      ? { expiresAt: record.expires_at }
      : {}),
    metadata: fromJsonRecord(record.metadata_json),
  });
}
