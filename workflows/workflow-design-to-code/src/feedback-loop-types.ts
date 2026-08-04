import { z } from "zod";
import {
  correctionAgentOutputV1Schema,
  correctionApprovalBindingV1Schema,
  correctionContextV1Schema,
  correctionPlanV1Schema,
  feedbackLoopInputV1Schema,
  feedbackLoopIterationV1Schema,
  feedbackLoopReportV1Schema,
  proposedCorrectionChangeV1Schema,
  visualValidationReportV1Schema,
  type FeedbackLoopInputV1,
} from "@designflow/sdk";

export const FEEDBACK_LOOP_ARTIFACT_IDS = {
  input: "feedback-loop-input",
  selection: "actionable-finding-selection",
  context: "correction-context",
  agentOutput: "correction-agent-output",
  plan: "correction-plan",
  changes: "proposed-correction-changes",
  approval: "correction-approval-binding",
  approvalConsumed: "consumed-correction-approval",
  snapshot: "correction-snapshot",
  application: "correction-application-result",
  validation: "correction-project-validation",
  rollback: "correction-rollback-result",
  revalidatedReport: "revalidated-visual-validation-report",
  iteration: "feedback-loop-iteration",
  report: "feedback-loop-report",
  summary: "stage-6-summary",
} as const;

export const FEEDBACK_LOOP_ARTIFACT_TYPES = {
  input: "feedback.input",
  selection: "feedback.actionable-selection",
  context: "feedback.correction-context",
  agentOutput: "feedback.correction-agent-output",
  plan: "feedback.correction-plan",
  changes: "feedback.proposed-correction-changes",
  approval: "feedback.correction-approval",
  snapshot: "feedback.correction-snapshot",
  application: "feedback.correction-application",
  validation: "feedback.correction-validation",
  rollback: "feedback.correction-rollback",
  revalidatedReport: "feedback.revalidated-visual-report",
  iteration: "feedback.iteration",
  report: "feedback.report",
  summary: "design.stage-6-summary",
} as const;

export const feedbackLoopWorkflowInputSchema = feedbackLoopInputV1Schema.extend({
  stateDirectory: z.string().min(1),
  affectedFileMap: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
  currentImplementationHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Optional CLI/child handoff when the immutable report is not in parent artifacts. */
  initialVisualValidationReport: visualValidationReportV1Schema.optional(),
  /** Test/child-boundary handoff for a report captured after mutation. */
  revalidatedVisualValidationReport: visualValidationReportV1Schema.optional(),
}).strict();
export type FeedbackLoopWorkflowInput = z.infer<typeof feedbackLoopWorkflowInputSchema>;

export const actionableFindingSelectionSchema = z.object({
  schemaVersion: z.literal("1"), selectedFindingIds: z.array(z.string().min(1)).max(20), excludedFindingIds: z.array(z.string().min(1)).max(500), reason: z.string().min(1).max(2_000), stopReason: z.enum(["no_actionable_findings", "visual_validation_inconclusive", "renderer_unavailable"]).optional(),
}).strict();

export const proposedCorrectionChangesSchema = z.object({ schemaVersion: z.literal("1"), changes: z.array(proposedCorrectionChangeV1Schema).max(20), contentHash: z.string().regex(/^[a-f0-9]{64}$/), totalBytes: z.number().int().nonnegative(), dependencyCount: z.number().int().nonnegative() }).strict();
export const correctionAgentOutputSchema = correctionAgentOutputV1Schema;
export const correctionContextSchema = correctionContextV1Schema;
export const correctionPlanSchema = correctionPlanV1Schema;
export const correctionApprovalBindingSchema = correctionApprovalBindingV1Schema;
export const feedbackLoopIterationSchema = feedbackLoopIterationV1Schema;
export const feedbackLoopReportSchema = feedbackLoopReportV1Schema;
export const revalidatedReportSchema = visualValidationReportV1Schema;

export type FeedbackLoopInput = FeedbackLoopInputV1;
export type ActionableFindingSelection = z.infer<typeof actionableFindingSelectionSchema>;
export type ProposedCorrectionChanges = z.infer<typeof proposedCorrectionChangesSchema>;
