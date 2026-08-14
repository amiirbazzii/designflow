// workflows/workflow-design-to-code/src/finalization/finalization-workflow.ts
import type { ExecutionPolicy, WorkflowDefinition, WorkflowPackage } from "@designflow/sdk";

import {
  applyApprovedFileChangesCapability,
  createProjectSnapshotCapability,
  storeImplementationApprovalCapability,
  validateImplementationCapability,
} from "../implementation/implementation-side-effect-capabilities";
import {
  inspectFinalizationProjectCapability,
  resolveSelectedProposalCapability,
  storeFinalizationResultCapability,
  storeFinalReviewCapability,
} from "./finalization-capabilities";

/**
 * The internal V2 finalization stage (V2-7).
 *
 *   inspect → resolve selected P* → review → approval binding
 *     → [human approval gate] → snapshot → apply P* → required validation
 *     → finalization result
 *
 * Snapshot, apply, validation and rollback are the existing stage-4
 * capabilities, reused unchanged — no parallel mutation machinery. The human
 * gate is the existing execution-policy approval on the snapshot node, so the
 * engine's own binding construction and post-approval re-verification (both
 * routed through the authoritative verifier) guard the resume. No Coordinator,
 * no model calls, and the public flagship path is unchanged.
 */
export const designToCodeV2FinalizeWorkflow: WorkflowDefinition = {
  id: "design-to-code-v2-finalize",
  name: "Design → Code (V2 final approval & apply)",
  description: "Verifies, reviews, approves and applies the convergence-selected proposal.",
  nodes: [
    {
      id: "inspect-finalization-project",
      capabilityId: "inspect-finalization-project",
      inputMap: { $workflowInput: true },
      produces: ["project-implementation-context"],
      next: ["resolve-selected-proposal"],
    },
    {
      id: "resolve-selected-proposal",
      capabilityId: "resolve-selected-proposal",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["inspect-finalization-project"] },
      produces: ["proposed-file-changes"],
      next: ["store-final-review"],
    },
    {
      id: "store-final-review",
      capabilityId: "store-final-review",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["resolve-selected-proposal"] },
      produces: ["v2-final-review"],
      next: ["request-implementation-approval"],
    },
    {
      id: "request-implementation-approval",
      capabilityId: "request-implementation-approval",
      inputMap: {},
      execution: { dependsOn: ["store-final-review"] },
      produces: ["implementation-approval"],
      next: ["create-project-snapshot"],
    },
    {
      id: "create-project-snapshot",
      capabilityId: "create-project-snapshot",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["request-implementation-approval"] },
      produces: ["project-snapshot"],
      next: ["apply-approved-file-changes"],
    },
    {
      id: "apply-approved-file-changes",
      capabilityId: "apply-approved-file-changes",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["create-project-snapshot"] },
      produces: ["file-application-result"],
      next: ["run-project-validation"],
    },
    {
      id: "run-project-validation",
      capabilityId: "run-project-validation",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["apply-approved-file-changes"] },
      produces: ["implementation-validation"],
      next: ["store-finalization-result"],
    },
    {
      id: "store-finalization-result",
      capabilityId: "store-finalization-result",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["run-project-validation"] },
      produces: ["v2-finalization-result"],
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["v2", "finalization", "approval", "apply", "internal"],
  },
};

/**
 * The human gate: exactly the existing approval-policy mechanism, bound to
 * the exact proposal and project-context artifacts. A model cannot grant
 * this; the engine creates the request and only the approval manager's
 * grant — a human, or an explicitly pre-authorized session policy — resumes.
 */
export const designToCodeV2FinalizeApprovalPolicy: ExecutionPolicy = {
  id: "design-to-code-v2-finalize-approval",
  name: "Design → Code V2 finalization approval",
  rules: [
    {
      id: "approve-v2-final-apply",
      type: "require_approval",
      target: { workflowId: "design-to-code-v2-finalize", nodeId: "create-project-snapshot" },
      metadata: {
        prompt: "Apply the reviewed implementation to the registered project?",
        reason: "DesignFlow will create a rollback snapshot and modify only the approved project files.",
        proposalArtifactId: "proposed-file-changes",
        projectContextArtifactId: "project-implementation-context",
        approvalModes: ["manual"],
      },
    },
  ],
};

const capabilities = [
  inspectFinalizationProjectCapability,
  resolveSelectedProposalCapability,
  storeFinalReviewCapability,
  storeImplementationApprovalCapability,
  createProjectSnapshotCapability,
  applyApprovedFileChangesCapability,
  validateImplementationCapability,
  storeFinalizationResultCapability,
];

export const designToCodeV2FinalizeWorkflowPackage: WorkflowPackage = {
  id: "design-to-code-v2-finalize",
  name: "Design → Code (V2 final approval & apply)",
  version: "0.1.0",
  description: "Internal V2 stage: authoritative binding verification, human approval, snapshot, apply, validation.",
  capabilities: capabilities.map((capability) => capability.id),
  metadata: { author: "DesignFlow Team", tags: ["v2", "finalization", "internal"] },
  definition: designToCodeV2FinalizeWorkflow,
  load(registry) {
    for (const capability of capabilities) registry.register(capability);
  },
};
