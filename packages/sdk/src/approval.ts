// packages/sdk/src/approval.ts
import { z } from "zod";

// ── Approval Request Schema ─────────────────────────────────────

export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalRequestSchema = z.object({
  id: z.string().min(1),
  executionId: z.string().min(1),
  workflowId: z.string().min(1),
  status: approvalStatusSchema,
  reason: z.string().min(1),
  createdAt: z.number(),
  resolvedAt: z.number().optional(),
  /**
   * When this request stops being answerable, epoch milliseconds.
   *
   * Optional, the same as `AgentSession.expiresAt` — a request created before
   * this field existed simply never expires, rather than being retroactively
   * treated as stale. `ApprovalManager` implementations default this for
   * every newly created request; see each implementation's `createRequest`.
   */
  expiresAt: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

/**
 * Whether a request can no longer be decided, given the moment to check
 * against.
 *
 * Only a still-`pending` request is subject to expiry — one already
 * `approved`/`rejected` answers "can this still authorize execution?" on its
 * own, and should keep reading as what it actually resolved as. The one
 * place this comparison is made; every `ApprovalManager` consults it before
 * honoring a decision.
 */
export function isApprovalExpired(approval: ApprovalRequest, nowMs: number): boolean {
  return approval.status === "pending" && approval.expiresAt !== undefined && approval.expiresAt <= nowMs;
}

/**
 * How long an approval request stays answerable when nothing more specific
 * is configured — seven days, the same conservative default
 * `AgentSessionService`'s own `expirationDays` uses for a session. Every
 * `ApprovalManager` implementation falls back to this when `createRequest` is
 * not given an explicit `expiresAt`, so a pending approval nobody ever
 * decides does not sit answerable forever.
 */
export const DEFAULT_APPROVAL_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

// ── Approval Decision Schema ────────────────────────────────────

export const approvalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
  decidedAt: z.number(),
});

export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

// ── Approval Manager Interface ──────────────────────────────────

export interface ApprovalManager {
  /**
   * @param expiresAt Epoch milliseconds after which the request can no
   * longer be decided. Omit to use the implementation's own default (see
   * `DEFAULT_APPROVAL_EXPIRATION_MS`).
   */
  createRequest(
    executionId: string,
    workflowId: string,
    reason: string,
    expiresAt?: number,
  ): Promise<ApprovalRequest>;

  approve(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest>;

  reject(
    approvalId: string,
    comment?: string,
  ): Promise<ApprovalRequest>;

  get(approvalId: string): Promise<ApprovalRequest | null>;
}