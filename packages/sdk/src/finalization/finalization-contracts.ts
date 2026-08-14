// packages/sdk/src/finalization/finalization-contracts.ts
import { z } from "zod";
import { visualConvergenceStatusSchema } from "../visual-convergence/visual-convergence-contracts";

/**
 * Final approval & apply (Agent Architecture V2, phase V2-7).
 *
 *   Visual Convergence → selected proposal P* → review → human approval
 *     → authoritative binding verification → snapshot → apply P* → validation
 *
 * The invariant these contracts exist to make checkable:
 *
 *   selected proposal = displayed proposal = approved proposal = applied proposal
 *
 * No AI owns any part of this stage. Everything here is identity, review,
 * authority and provenance — zero model calls.
 */

export const V2_FINALIZATION_SCHEMA_VERSION = "1";
export const V2_FINAL_REVIEW_ARTIFACT_ID = "v2-final-review";
export const V2_FINAL_REVIEW_ARTIFACT_TYPE = "implementation.final-review";
export const V2_FINALIZATION_RESULT_ARTIFACT_ID = "v2-finalization-result";
export const V2_FINALIZATION_RESULT_ARTIFACT_TYPE = "implementation.finalization-result";

/**
 * The deterministic review model shown before approval.
 *
 * A view of the exact selected proposal artifact — never a second proposal
 * representation. Its file list is derived from the resolved proposal payload,
 * so when P1 was selected over a later P2, the user sees P1.
 */
export const finalImplementationReviewSchema = z
  .object({
    schemaVersion: z.literal(V2_FINALIZATION_SCHEMA_VERSION),
    proposalArtifactId: z.string().min(1).max(256),
    proposalHash: z.string().min(1).max(200),
    projectId: z.string().min(1).max(200),
    baseProjectFingerprint: z.string().min(1).max(200),
    convergence: z
      .object({
        status: visualConvergenceStatusSchema,
        selectedIteration: z.number().int().nonnegative(),
        iterationsPerformed: z.number().int().nonnegative(),
      })
      .strict(),
    visual: z
      .object({
        outcome: z.string().min(1).max(60),
        remainingFindingCount: z.number().int().nonnegative(),
        remainingFindings: z.array(z.string().min(1).max(300)).max(24).default([]),
      })
      .strict(),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(400),
            action: z.enum(["create", "modify", "delete"]),
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(200),
    packageChanges: z.array(z.string().min(1).max(200)).max(64).default([]),
    validationSummary: z.array(z.string().min(1).max(300)).max(16).default([]),
  })
  .strict();

export type FinalImplementationReview = z.infer<typeof finalImplementationReviewSchema>;

export const v2FinalizationStatusSchema = z.enum([
  "applied_validated",
  "approval_declined",
  "approval_expired",
  "project_changed",
  "binding_mismatch",
  "apply_failed",
  "validation_failed_rolled_back",
  "cancelled",
]);

export type V2FinalizationStatus = z.infer<typeof v2FinalizationStatusSchema>;

/**
 * The typed record of one finalization run.
 *
 * `binding` carries the exact identities the run was held to; the
 * load-bearing audit fact is that `proposalHash` here equals the convergence
 * artifact's `selectedProposalHash`, the approval's bound hash, and the
 * application result's applied hash — an equality the host verifies, never
 * assumes.
 */
export const v2FinalizationResultSchema = z
  .object({
    schemaVersion: z.literal(V2_FINALIZATION_SCHEMA_VERSION),
    status: v2FinalizationStatusSchema,
    binding: z
      .object({
        projectId: z.string().min(1).max(200),
        baseProjectFingerprint: z.string().min(1).max(200),
        proposalArtifactId: z.string().min(1).max(256),
        proposalHash: z.string().min(1).max(200),
        approvalId: z.string().min(1).max(200).optional(),
        convergenceArtifactId: z.string().min(1).max(256),
        selectedIteration: z.number().int().nonnegative().optional(),
      })
      .strict(),
    /** sha256 the application layer recorded for what it actually wrote. */
    appliedProposalHash: z.string().min(1).max(200).optional(),
    snapshotRef: z.string().min(1).max(256).optional(),
    applicationRef: z.string().min(1).max(256).optional(),
    validationRef: z.string().min(1).max(256).optional(),
    rollbackPerformed: z.boolean().default(false),
    metrics: z
      .object({
        finalizationSelectedIteration: z.number().int().nonnegative().optional(),
        finalizationBindingChecks: z.number().int().nonnegative(),
        finalizationApprovalOutcome: z.enum(["approved", "declined", "expired", "not_requested"]),
        finalizationProjectDriftDetected: z.boolean(),
        finalizationSnapshotCreated: z.boolean(),
        finalizationFilesApplied: z.number().int().nonnegative(),
        finalizationValidationStatus: z.enum(["passed", "failed", "not_run"]),
        finalizationRollbackPerformed: z.boolean(),
      })
      .strict(),
    notes: z.array(z.string().min(1).max(400)).max(16).default([]),
  })
  .strict();

export type V2FinalizationResult = z.infer<typeof v2FinalizationResultSchema>;
