import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) => z.string().min(1).max(max);
const artifact = z
  .object({ artifactId: text(256), artifactHash: hash, version: text(32) })
  .strict();

export const feedbackLoopParentStateSchema = z.enum([
  "created",
  "selecting_findings",
  "preparing_iteration",
  "waiting_approval",
  "applying_correction",
  "validating_project",
  "revalidating_visuals",
  "evaluating_iteration",
  "waiting_next_iteration",
  "completed",
  "stopped",
  "failed",
]);
export type FeedbackLoopParentState = z.infer<
  typeof feedbackLoopParentStateSchema
>;

export const feedbackLoopParentChildStatusSchema = z.enum([
  "not_started",
  "awaiting_approval",
  "rejected",
  "applying",
  "rolled_back",
  "visual_report_ready",
  "evaluated",
  "completed",
  "stopped",
]);

export const feedbackLoopParentSideEffectSchema = z
  .object({
    recordId: text(256),
    parentExecutionId: text(256),
    childExecutionId: text(256).optional(),
    iterationNumber: z.number().int().positive(),
    nodeId: text(256),
    inputIdentity: hash,
    completionIdentity: hash.optional(),
    status: z.enum(["pending", "completed", "skipped", "failed"]),
    artifactIds: z.array(text(256)).max(64),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export const feedbackLoopParentIterationSchema = z
  .object({
    iterationId: text(256),
    parentExecutionId: text(256),
    iterationNumber: z.number().int().positive(),
    childExecutionId: text(256),
    inputVisualReportHash: hash,
    inputProjectFingerprint: hash,
    correctionProposalHash: hash,
    proposalArtifactIds: z.array(text(256)).max(32),
    approvalIds: z.array(text(256)).max(8),
    approvalConsumptionArtifactIds: z.array(text(256)).max(8).default([]),
    snapshotArtifactIds: z.array(text(256)).max(8),
    applicationArtifactIds: z.array(text(256)).max(8),
    validationArtifactIds: z.array(text(256)).max(8),
    rollbackArtifactIds: z.array(text(256)).max(8),
    previewArtifactIds: z.array(text(256)).max(8).default([]),
    screenshotEvidenceArtifactIds: z.array(text(256)).max(8).default([]),
    domEvidenceArtifactIds: z.array(text(256)).max(8).default([]),
    comparisonArtifactIds: z.array(text(256)).max(8).default([]),
    evaluationArtifactIds: z.array(text(256)).max(8).default([]),
    visualReportArtifactIds: z.array(text(256)).max(8),
    status: feedbackLoopParentChildStatusSchema,
    stopReason: text(128).optional(),
    resolvedFindings: z.array(text(256)).max(500),
    remainingFindings: z.array(text(256)).max(500),
    introducedFindings: z.array(text(256)).max(500),
    screenshotCaptureCounts: z
      .record(z.string().min(1).max(64), z.number().int().nonnegative())
      .default({}),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
  })
  .strict();

const parentInput = z.record(z.string().max(256), z.unknown());

const sideEffectCounts = z
  .object({
    childCreation: z.number().int().nonnegative(),
    approvalConsumption: z.number().int().nonnegative(),
    snapshotCreation: z.number().int().nonnegative(),
    correctionApplication: z.number().int().nonnegative(),
    rollback: z.number().int().nonnegative(),
    projectValidation: z.number().int().nonnegative(),
    previewLaunch: z.number().int().nonnegative(),
    screenshotCaptureByViewport: z
      .record(z.string().min(1).max(64), z.number().int().nonnegative())
      .refine((value) => Object.keys(value).length <= 8),
    domStyleCollection: z.number().int().nonnegative(),
    imageComparison: z.number().int().nonnegative(),
    visualReportCreation: z.number().int().nonnegative(),
    iterationEvaluation: z.number().int().nonnegative(),
    finalReportCreation: z.number().int().nonnegative(),
  })
  .strict();

export const feedbackLoopParentRecordV1Schema = z
  .object({
    schemaVersion: z.literal("1"),
    parentExecutionId: text(256),
    workflowId: z.literal("design-to-code-feedback-loop"),
    state: feedbackLoopParentStateSchema,
    projectId: text(256),
    canonicalRootIdentity: hash,
    initialProjectFingerprint: hash,
    currentProjectFingerprint: hash,
    initialImplementationHash: hash,
    currentImplementationHash: hash,
    initialVisualReport: artifact,
    currentVisualReport: artifact,
    input: parentInput,
    iterationPolicy: parentInput,
    currentIterationNumber: z.number().int().nonnegative().max(8),
    maxIterations: z.number().int().positive().max(8),
    childExecutionIds: z.array(text(256)).max(8),
    iterations: z.array(feedbackLoopParentIterationSchema).max(8),
    resolvedFindings: z.array(text(256)).max(500),
    remainingFindings: z.array(text(256)).max(500),
    introducedFindings: z.array(text(256)).max(500),
    screenshotCaptureCounts: z
      .record(z.string().min(1).max(64), z.number().int().nonnegative())
      .default({}),
    cumulativeFileChanges: z.array(text(512)).max(160),
    rollbackCount: z.number().int().nonnegative().max(64),
    sideEffectCounts,
    finalStatus: z
      .enum(["pass", "pass_with_findings", "fail", "stopped"])
      .optional(),
    stopReason: text(128).optional(),
    finalReportArtifactId: text(256).optional(),
    finalReportHash: hash.optional(),
    finalReport: z.record(z.string().max(256), z.unknown()).optional(),
    sideEffects: z.array(feedbackLoopParentSideEffectSchema).max(256),
    traceIds: z.array(text(256)).max(128),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type FeedbackLoopParentRecordV1 = z.infer<
  typeof feedbackLoopParentRecordV1Schema
>;

export const feedbackLoopParentReportV1Schema = z
  .object({
    schemaVersion: z.literal("1"),
    parentExecutionId: text(256),
    projectId: text(256),
    initialVisualReportId: text(256),
    finalVisualReportId: text(256),
    childIterationIds: z.array(text(256)).max(8),
    iterations: z.array(feedbackLoopParentIterationSchema).max(8),
    proposalArtifactIds: z.array(text(256)).max(64),
    approvalIds: z.array(text(256)).max(64),
    snapshotArtifactIds: z.array(text(256)).max(64),
    applicationArtifactIds: z.array(text(256)).max(64),
    validationArtifactIds: z.array(text(256)).max(64),
    rollbackArtifactIds: z.array(text(256)).max(64),
    visualReportArtifactIds: z.array(text(256)).max(64),
    resolvedFindings: z.array(text(256)).max(500),
    remainingFindings: z.array(text(256)).max(500),
    introducedFindings: z.array(text(256)).max(500),
    totalApprovals: z.number().int().nonnegative(),
    totalFilesChanged: z.number().int().nonnegative(),
    rollbackCount: z.number().int().nonnegative(),
    sideEffectCounts,
    finalStatus: z.enum(["pass", "pass_with_findings", "fail", "stopped"]),
    stopReason: text(128),
    iterationLimit: z.number().int().positive().max(8),
    limitations: z.array(text(1_000)).max(64),
    traceIds: z.array(text(256)).max(128),
    createdAt: z.string().datetime(),
  })
  .strict();
export type FeedbackLoopParentReportV1 = z.infer<
  typeof feedbackLoopParentReportV1Schema
>;
