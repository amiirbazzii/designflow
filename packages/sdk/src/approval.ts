// packages/sdk/src/approval.ts
import { z } from "zod";

// ── Approval Request Schema ─────────────────────────────────────

export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
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
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

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
  createRequest(
    executionId: string,
    workflowId: string,
    reason: string,
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