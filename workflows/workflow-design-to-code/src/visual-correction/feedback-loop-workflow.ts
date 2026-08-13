import type { WorkflowDefinition } from "@designflow/sdk";

/**
 * Stage 6 is deliberately a separate internal workflow. It has one bounded
 * correction iteration per execution; a host may start a new execution only
 * after deterministic evaluation authorizes continuation. The write boundary
 * is the snapshot node, which is protected by the package approval policy.
 */
export const designToCodeFeedbackLoopWorkflow: WorkflowDefinition = {
  id: "design-to-code-feedback-loop",
  name: "Design → Code (Controlled Visual Correction)",
  description: "Evidence-bound, approval-gated, bounded visual correction iteration.",
  nodes: [
    { id: "store-feedback-loop-input", capabilityId: "store-feedback-loop-input", inputMap: { $workflowInput: true }, produces: ["feedback-loop-input"], next: ["select-actionable-findings"] },
    { id: "select-actionable-findings", capabilityId: "select-actionable-findings", inputMap: { $workflowInput: true }, execution: { dependsOn: ["store-feedback-loop-input"] }, produces: ["actionable-finding-selection"], next: ["prepare-correction-context"] },
    { id: "prepare-correction-context", capabilityId: "prepare-correction-context", inputMap: { $workflowInput: true }, execution: { dependsOn: ["select-actionable-findings"] }, produces: ["correction-context"], next: ["invoke-visual-correction-agent"] },
    { id: "invoke-visual-correction-agent", capabilityId: "invoke-visual-correction-agent", inputMap: {}, execution: { dependsOn: ["prepare-correction-context"] }, produces: ["correction-agent-output"], next: ["store-correction-plan"] },
    { id: "store-correction-plan", capabilityId: "store-correction-plan", inputMap: {}, execution: { dependsOn: ["invoke-visual-correction-agent"] }, produces: ["correction-plan"], next: ["store-proposed-correction-changes"] },
    { id: "store-proposed-correction-changes", capabilityId: "store-proposed-correction-changes", inputMap: {}, execution: { dependsOn: ["store-correction-plan"] }, produces: ["proposed-correction-changes"], next: ["request-correction-approval"] },
    { id: "request-correction-approval", capabilityId: "request-correction-approval", inputMap: {}, execution: { dependsOn: ["store-proposed-correction-changes"] }, produces: ["correction-approval-binding"], next: ["create-correction-snapshot"] },
    { id: "create-correction-snapshot", capabilityId: "create-correction-snapshot", inputMap: { $workflowInput: true }, execution: { dependsOn: ["request-correction-approval"] }, produces: ["correction-snapshot"], next: ["consume-correction-approval"] },
    { id: "consume-correction-approval", capabilityId: "consume-correction-approval", inputMap: {}, execution: { dependsOn: ["create-correction-snapshot"] }, produces: ["consumed-correction-approval"], next: ["apply-approved-correction"] },
    { id: "apply-approved-correction", capabilityId: "apply-approved-correction", inputMap: { $workflowInput: true }, execution: { dependsOn: ["consume-correction-approval"] }, produces: ["correction-application-result"], next: ["run-correction-project-validation"] },
    { id: "run-correction-project-validation", capabilityId: "run-correction-project-validation", inputMap: { $workflowInput: true }, execution: { dependsOn: ["apply-approved-correction"] }, produces: ["correction-project-validation"], next: ["rerun-visual-validation"] },
    { id: "rerun-visual-validation", capabilityId: "rerun-stage5-visual-validation", inputMap: {}, execution: { dependsOn: ["run-correction-project-validation"] }, produces: ["feedback-loop-revalidation-output"], next: ["normalize-feedback-loop-revalidation-gate"] },
    { id: "normalize-feedback-loop-revalidation-gate", capabilityId: "normalize-feedback-loop-revalidation-gate", inputMap: {}, execution: { dependsOn: ["rerun-visual-validation"] }, produces: ["feedback-loop-revalidation-gate"], next: ["evaluate-feedback-loop"] },
    { id: "evaluate-feedback-loop", capabilityId: "evaluate-feedback-loop", inputMap: { $workflowInput: true }, execution: { dependsOn: ["normalize-feedback-loop-revalidation-gate"] }, produces: ["feedback-loop-report"], next: ["store-feedback-loop-iteration"] },
    { id: "store-feedback-loop-iteration", capabilityId: "store-feedback-loop-iteration", inputMap: {}, execution: { dependsOn: ["evaluate-feedback-loop"] }, produces: ["feedback-loop-iteration"], next: ["store-stage-6-summary"] },
    { id: "store-stage-6-summary", capabilityId: "store-stage-6-summary", inputMap: {}, execution: { dependsOn: ["store-feedback-loop-iteration"] }, produces: ["stage-6-summary"], next: [] },
  ],
  metadata: { version: "0.1.0", author: "DesignFlow Team", tags: ["stage-6", "visual-correction", "experimental", "internal"] },
};
