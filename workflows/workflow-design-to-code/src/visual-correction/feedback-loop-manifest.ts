import type { ExecutionPolicy, WorkflowPackage } from "@designflow/sdk";
import { designToCodeFeedbackLoopWorkflow } from "../visual-correction/feedback-loop-workflow";
import { feedbackLoopCapabilities } from "../visual-correction/feedback-loop-capabilities";

export const designToCodeFeedbackLoopApprovalPolicy: ExecutionPolicy = {
  id: "design-to-code-feedback-loop-approval",
  name: "Controlled visual correction approval",
  rules: [{ id: "approve-correction-write", type: "require_approval", target: { workflowId: "design-to-code-feedback-loop", nodeId: "create-correction-snapshot" }, metadata: { prompt: "Approve these exact correction changes? [approve / reject]", reason: "DesignFlow will create one rollback snapshot and modify only the reviewed correction proposal.", protectedNodeId: "create-correction-snapshot", proposalArtifactId: "proposed-correction-changes", planArtifactId: "correction-plan" } }],
};

export const designToCodeFeedbackLoopWorkflowPackage: WorkflowPackage = {
  id: "design-to-code-feedback-loop",
  name: "Design → Code (Controlled Visual Correction)",
  version: "0.1.0",
  description: "Internal Stage 6 evidence-bound correction loop with explicit approval before every write.",
  capabilities: feedbackLoopCapabilities.map((capability) => capability.id),
  metadata: { author: "DesignFlow Team", tags: ["stage-6", "visual-correction", "experimental", "internal"] },
  definition: designToCodeFeedbackLoopWorkflow,
  load(registry) { for (const capability of feedbackLoopCapabilities) registry.register(capability); },
};
