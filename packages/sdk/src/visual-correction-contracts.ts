import { z } from "zod";
import { visualFindingV1Schema, visualValidationReportV1Schema } from "./visual-validation-contracts";

export const VISUAL_CORRECTION_SCHEMA_VERSION = "1" as const;
export const VISUAL_CORRECTION_AGENT_ID = "visual-correction-agent" as const;
export const VISUAL_CORRECTION_AGENT_VERSION = "0.1.0" as const;

export const FEEDBACK_LOOP_HARD_LIMITS = {
  maxIterations: 8,
  maxFilesPerIteration: 20,
  maxChangedBytesPerIteration: 1_000_000,
  maxDependenciesPerIteration: 2,
  maxFindingsPerIteration: 20,
} as const;

/**
 * Hard bound on host-authorized composition files added to a correction scope
 * beyond the parent implementation's changed files. Not user-configurable.
 */
export const MAX_CORRECTION_COMPOSITION_FILES = 8 as const;

export const feedbackLoopStopReasonSchema = z.enum([
  "passed", "pass_with_findings", "no_actionable_findings", "rejected",
  "project_validation_failed", "rollback_failed", "visual_validation_failed",
  "visual_validation_inconclusive", "renderer_unavailable", "no_improvement",
  "regression_detected", "iteration_limit_reached", "stale_state", "aborted",
]);
export type FeedbackLoopStopReason = z.infer<typeof feedbackLoopStopReasonSchema>;

const text = (max: number) => z.string().min(1).max(max);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const artifact = z.object({ artifactId: text(256), artifactHash: sha256, version: text(32) }).strict();
const project = z.object({ id: text(256), name: text(256), rootPath: text(4_096), canonicalRootIdentity: sha256 }).strict();
const filePath = z.string().min(1).max(512).refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "path must be relative to the canonical project root");
const findingId = text(256);
const evidenceId = text(256);
const iterationPolicy = z.object({
  maxIterations: z.number().int().positive().max(FEEDBACK_LOOP_HARD_LIMITS.maxIterations).default(3),
  maxFilesPerIteration: z.number().int().positive().max(FEEDBACK_LOOP_HARD_LIMITS.maxFilesPerIteration).default(5),
  maxChangedBytesPerIteration: z.number().int().positive().max(FEEDBACK_LOOP_HARD_LIMITS.maxChangedBytesPerIteration).default(200_000),
  maxDependenciesPerIteration: z.number().int().nonnegative().max(FEEDBACK_LOOP_HARD_LIMITS.maxDependenciesPerIteration).default(0),
  maxFindingsPerIteration: z.number().int().positive().max(FEEDBACK_LOOP_HARD_LIMITS.maxFindingsPerIteration).default(5),
  modelInterpretedAllowed: z.boolean().default(false),
  modelConfidenceThreshold: z.number().min(0).max(1).default(0.9),
  requireApprovalEveryIteration: z.literal(true).default(true),
  continueAfterImprovement: z.boolean().default(true),
}).strict();
export type FeedbackLoopIterationPolicy = z.infer<typeof iterationPolicy>;

const validationConfiguration = z.object({
  commands: z.array(z.object({ name: z.enum(["format", "typecheck", "lint", "build", "test", "preview"]), executable: z.enum(["npm", "bun", "pnpm", "yarn"]), args: z.array(text(256)).max(32), required: z.boolean() }).strict()).max(8),
  timeoutMs: z.number().int().positive().max(120_000).default(60_000),
  outputLimitBytes: z.number().int().positive().max(200_000).default(100_000),
}).strict();

const viewportConfiguration = z.object({
  viewports: z.array(z.object({ id: text(64), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096) }).strict()).min(1).max(8),
  referenceEvidenceIds: z.array(evidenceId).max(64),
  rendererVersion: text(128),
  comparisonAlgorithmVersion: text(128),
}).strict();

export const feedbackLoopInputV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), workflowId: z.literal("design-to-code-feedback-loop"), executionId: text(256), iterationNumber: z.number().int().positive().max(FEEDBACK_LOOP_HARD_LIMITS.maxIterations).default(1), project, projectFingerprint: sha256, currentImplementationHash: sha256, generatedImplementation: artifact, latestVisualValidationReport: artifact,
  designSpecification: artifact, designSystemMapping: artifact, actionableFindingIds: z.array(findingId).max(20), iterationPolicy, validationConfiguration, viewportConfiguration, referenceImagePayloads: z.record(z.string().max(25_000_000)).optional(),
  agentVersion: text(32), modelProfileId: text(128), timeouts: z.object({ agentMs: z.number().int().positive().max(120_000), approvalMs: z.number().int().positive().max(7 * 24 * 60 * 60_000) }).strict(), limits: z.object({ maxContextBytes: z.number().int().positive().max(1_000_000), maxPatchBytes: z.number().int().positive().max(1_000_000) }).strict(),
}).strict();
export type FeedbackLoopInputV1 = z.infer<typeof feedbackLoopInputV1Schema>;

const measurable = z.object({ expected: text(2_000).optional(), actual: text(2_000).optional(), delta: z.number().finite().optional() }).strict();
const finding = z.object({ findingId, classification: z.enum(["deterministic", "model-interpreted"]), affectedFiles: z.array(filePath).max(20), component: text(256).optional(), evidenceReferences: z.array(evidenceId).max(32), expected: text(2_000).optional(), actual: text(2_000).optional(), measurableDelta: z.number().finite().optional() }).strict();

/** A composition file the host authorized beyond the parent-changed scope, with deterministic provenance. */
export const compositionScopeEntrySchema = z.object({ path: filePath, reason: text(512), source: z.literal("deterministic-project-inspection") }).strict();
export type CompositionScopeEntry = z.infer<typeof compositionScopeEntrySchema>;

export const correctionContextV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), iterationNumber: z.number().int().positive(), selectedFindings: z.array(finding).max(20), visualFindings: z.array(visualFindingV1Schema).max(20), evidenceReferences: z.array(artifact).max(128), currentImplementationExcerpts: z.array(z.object({ path: filePath, content: text(50_000), hash: sha256 }).strict()).max(20), relevantDesignTokens: z.array(z.object({ name: text(256), reference: text(512), value: text(512).optional() }).strict()).max(128), relevantComponents: z.array(z.object({ name: text(256), path: filePath, excerpt: text(20_000).optional() }).strict()).max(64), allowedFileScope: z.array(filePath).max(20), compositionAuthorizedFiles: z.array(compositionScopeEntrySchema).max(MAX_CORRECTION_COMPOSITION_FILES).default([]), forbiddenPaths: z.array(text(512)).max(64), projectCommands: validationConfiguration.shape.commands, currentProjectFingerprint: sha256, currentImplementationHash: sha256, previousIterationSummaries: z.array(text(4_000)).max(8), designSystemMapping: artifact, evidenceOnly: z.literal(true),
}).strict();
export type CorrectionContextV1 = z.infer<typeof correctionContextV1Schema>;

const mapping = z.object({ findingId, changeIndexes: z.array(z.number().int().nonnegative()).min(1).max(20), expectedOutcome: text(2_000), evidenceIds: z.array(evidenceId).min(1).max(32) }).strict();
export const correctionPlanV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), iterationNumber: z.number().int().positive(), objective: text(4_000), selectedFindingIds: z.array(findingId).min(1).max(20), findingToChangeMapping: z.array(mapping).min(1).max(20), filesExpectedToChange: z.array(filePath).max(20), filesExpectedToRemainUnchanged: z.array(filePath).max(100), dependencyChanges: z.array(text(256)).max(2), validationCommands: z.array(text(512)).max(8), visualRevalidationRequirements: z.object({ required: z.literal(true), viewports: z.array(text(64)).min(1).max(8), invalidateOldScreenshots: z.literal(true) }).strict(), risks: z.array(text(1_000)).max(32), rollbackStatement: text(2_000), confidence: z.number().min(0).max(1), limitations: z.array(text(1_000)).max(32), agent: z.object({ id: z.literal(VISUAL_CORRECTION_AGENT_ID), version: text(32), modelProfileId: text(128) }).strict(), evidenceReferences: z.array(evidenceId).min(1).max(128),
}).strict();
export type CorrectionPlanV1 = z.infer<typeof correctionPlanV1Schema>;

export const proposedCorrectionChangeV1Schema = z.object({
  schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), operation: z.enum(["create", "modify", "delete"]), relativePath: filePath, baseFileHash: sha256.optional(), proposedContentHash: sha256.optional(), proposedContent: z.string().max(200_000).optional(), patch: z.string().max(200_000).optional(), reason: text(2_000), findingIds: z.array(findingId).min(1).max(20), evidenceIds: z.array(evidenceId).min(1).max(32), expectedMeasurableOutcome: measurable, designSystemReferences: z.array(text(512)).max(32), dependencyChangeRequired: z.boolean(),
}).strict().superRefine((change, ctx) => { if (change.operation === "modify" && (!change.baseFileHash || change.proposedContent === undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "modify requires baseFileHash and proposedContent" }); if (change.operation === "create" && change.baseFileHash !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "create cannot carry baseFileHash" }); if (change.operation !== "delete" && change.proposedContentHash === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "create and modify require proposedContentHash" }); if (change.operation === "delete" && (change.proposedContent !== undefined || change.patch !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "delete cannot carry content" }); });
export type ProposedCorrectionChangeV1 = z.infer<typeof proposedCorrectionChangeV1Schema>;

export const correctionAgentOutputV1Schema = z.object({ schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), plan: correctionPlanV1Schema, changes: z.array(proposedCorrectionChangeV1Schema).max(20), traceIds: z.array(text(256)).max(32) }).strict();
export type CorrectionAgentOutputV1 = z.infer<typeof correctionAgentOutputV1Schema>;

export const correctionApprovalBindingV1Schema = z.object({ schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), workflowId: text(256), executionId: text(256), iterationId: text(256), iterationNumber: z.number().int().positive(), correctionPlanArtifactId: text(256), correctionPlanHash: sha256, proposedCorrectionArtifactId: text(256), proposedCorrectionHash: sha256, selectedFindingIds: z.array(findingId).min(1).max(20), projectId: text(256), canonicalRootIdentity: sha256, currentProjectFingerprint: sha256, currentImplementationHash: sha256, previousVisualReportHash: sha256, fileCount: z.number().int().nonnegative().max(20), dependencyCount: z.number().int().nonnegative().max(2), validationCommands: z.array(text(512)).max(8), revalidationConfigurationHash: sha256, approvalId: text(256), expiresAt: z.string().datetime(), protectedNodeId: z.literal("create-correction-snapshot"), consumed: z.boolean(),
  preflightProposalHash: sha256.optional(),
}).strict();
export type CorrectionApprovalBindingV1 = z.infer<typeof correctionApprovalBindingV1Schema>;

const resultStatus = z.enum(["pending", "passed", "failed", "rolled_back", "rejected", "stale"]);
export const feedbackLoopIterationV1Schema = z.object({ schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), iterationId: text(256), iterationNumber: z.number().int().positive(), inputReportId: text(256), selectedFindings: z.array(findingId).max(20), correctionPlanArtifact: artifact.optional(), approvalOutcome: z.enum(["pending", "approved", "rejected", "expired", "stale"]).optional(), snapshotArtifact: artifact.optional(), applicationResult: z.object({ status: resultStatus, changedFiles: z.array(filePath).max(20), bytesChanged: z.number().int().nonnegative() }).optional(), projectValidationResult: z.object({ status: z.enum(["passed", "failed", "timed_out"]), checks: z.array(z.object({ name: text(64), status: z.enum(["passed", "failed", "skipped", "unavailable"]), required: z.boolean(), outputArtifactId: text(256).optional() }).strict()).max(8) }).optional(), rollbackResult: z.object({ status: z.enum(["not_required", "passed", "failed"]), artifactId: text(256).optional() }).strict().optional(), newVisualValidationReport: artifact.optional(), findingsResolved: z.array(findingId).max(20), findingsRemaining: z.array(findingId).max(20), findingsIntroduced: z.array(findingId).max(20), metricDeltas: z.record(z.string(), z.number().finite()).default({}), status: resultStatus, stopReason: feedbackLoopStopReasonSchema.optional(), startedAt: z.string().datetime(), endedAt: z.string().datetime(), traceIds: z.array(text(256)).max(32),
}).strict();
export type FeedbackLoopIterationV1 = z.infer<typeof feedbackLoopIterationV1Schema>;

export const feedbackLoopReportV1Schema = z.object({ schemaVersion: z.literal(VISUAL_CORRECTION_SCHEMA_VERSION), projectId: text(256), initialVisualReportId: text(256), finalVisualReportId: text(256), iterations: z.array(feedbackLoopIterationV1Schema).max(8), initialFindings: z.array(findingId).max(500), resolvedFindings: z.array(findingId).max(500), unresolvedFindings: z.array(findingId).max(500), introducedFindings: z.array(findingId).max(500), finalStatus: z.enum(["pass", "pass_with_findings", "fail", "stopped"]), stopReason: feedbackLoopStopReasonSchema, continuationAllowed: z.boolean().default(false), iterationLimit: z.number().int().positive().max(8), totalFilesChanged: z.number().int().nonnegative(), totalApprovals: z.number().int().nonnegative(), rollbacks: z.number().int().nonnegative(), overallConfidence: z.number().min(0).max(1), limitations: z.array(text(1_000)).max(64), agent: z.object({ id: z.literal(VISUAL_CORRECTION_AGENT_ID), version: text(32), modelProfileId: text(128) }).strict(), traceIds: z.array(text(256)).max(64),
}).strict();
export type FeedbackLoopReportV1 = z.infer<typeof feedbackLoopReportV1Schema>;

export { visualFindingV1Schema, visualValidationReportV1Schema };
