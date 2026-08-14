// workflows/workflow-design-to-code/src/flagship/flagship-workflow.ts
import type { Capability, ExecutionPolicy, WorkflowDefinition, WorkflowPackage } from "@designflow/sdk";

import { sharedFigmaSpecificationCapabilities } from "../figma-specification/figma-specification-manifest";
import { runVisualConvergenceCapability } from "../visual-convergence/visual-convergence-capability";
import {
  inspectFinalizationProjectCapability,
  resolveSelectedProposalCapability,
  storeFinalizationResultCapability,
  storeFinalReviewCapability,
} from "../finalization/finalization-capabilities";
import {
  applyApprovedFileChangesCapability,
  createProjectSnapshotCapability,
  storeImplementationApprovalCapability,
  validateImplementationCapability,
} from "../implementation/implementation-side-effect-capabilities";
import { flagshipCapabilities } from "./flagship-capabilities";
import { DESIGN_TO_CODE_V2_WORKFLOW_ID } from "./flagship-types";

const all = { $workflowInput: true } as const;

/**
 * The flagship Design-to-Code V2 workflow (V2-8).
 *
 * One inspectable chain, one execution, one lineage. Every stage is a reused
 * V2 capability or a thin flagship glue step; the four AI roles — Design
 * Interpreter, Project Mapper, UI Builder, Visual Critic — arrive through
 * injected seams, and no node anywhere in this definition can reach the
 * Coordinator or a legacy specialist agent.
 */
export const designToCodeV2Workflow: WorkflowDefinition = {
  id: DESIGN_TO_CODE_V2_WORKFLOW_ID,
  name: "Design Engineer",
  description: "Turns the selected Figma design into reviewed, approved code changes at the destination you chose.",
  nodes: [
    {
      id: "parse-figma-source",
      capabilityId: "parse-figma-source",
      inputMap: {
        designFile: { $workflowInput: "designFile" },
        frames: { $workflowInput: "frames" },
        allowFixtureNames: { $workflowInput: "allowFixtureNames" },
      },
      produces: ["parsed-figma-source"],
      next: ["retrieve-figma-source-snapshot"],
    },
    {
      id: "retrieve-figma-source-snapshot",
      capabilityId: "retrieve-figma-source-snapshot",
      inputMap: {
        captureScreenshots: { $workflowInput: "captureScreenshots" },
        refreshFigmaSource: { $workflowInput: "refreshFigmaSource" },
        sourceMode: { $workflowInput: "figmaSourceMode" },
        sourceKind: { $workflowInput: "figmaSourceKind" },
        serverIdentity: { $workflowInput: "figmaServerIdentity" },
      },
      execution: { dependsOn: ["parse-figma-source"] },
      produces: ["figma-source-snapshot"],
      next: ["compile-v2-blueprint"],
    },
    {
      id: "compile-v2-blueprint",
      capabilityId: "compile-v2-blueprint",
      inputMap: all,
      execution: { dependsOn: ["retrieve-figma-source-snapshot"] },
      produces: ["ui-blueprint"],
      next: ["compile-v2-project-context"],
    },
    {
      id: "compile-v2-project-context",
      capabilityId: "compile-v2-project-context",
      inputMap: all,
      execution: { dependsOn: ["compile-v2-blueprint"] },
      produces: ["project-context"],
      next: ["map-v2-project"],
    },
    {
      id: "map-v2-project",
      capabilityId: "map-v2-project",
      inputMap: all,
      execution: { dependsOn: ["compile-v2-project-context"] },
      produces: ["implementation-map"],
      next: ["build-v2-implementation"],
    },
    {
      id: "build-v2-implementation",
      capabilityId: "build-v2-implementation",
      inputMap: all,
      execution: { dependsOn: ["map-v2-project"] },
      produces: ["builder-proposal"],
      next: ["run-visual-convergence"],
    },
    {
      id: "run-visual-convergence",
      capabilityId: "run-visual-convergence",
      inputMap: all,
      execution: { dependsOn: ["build-v2-implementation"] },
      produces: ["visual-convergence"],
      next: ["assert-v2-finalizable"],
    },
    {
      id: "assert-v2-finalizable",
      capabilityId: "assert-v2-finalizable",
      inputMap: all,
      execution: { dependsOn: ["run-visual-convergence"] },
      produces: ["v2-finalization-eligibility"],
      next: ["inspect-finalization-project"],
    },
    {
      id: "inspect-finalization-project",
      capabilityId: "inspect-finalization-project",
      inputMap: all,
      execution: { dependsOn: ["assert-v2-finalizable"] },
      produces: ["project-implementation-context"],
      next: ["resolve-selected-proposal"],
    },
    {
      id: "resolve-selected-proposal",
      capabilityId: "resolve-selected-proposal",
      inputMap: all,
      execution: { dependsOn: ["inspect-finalization-project"] },
      produces: ["proposed-file-changes"],
      next: ["store-final-review"],
    },
    {
      id: "store-final-review",
      capabilityId: "store-final-review",
      inputMap: all,
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
      inputMap: all,
      execution: { dependsOn: ["request-implementation-approval"] },
      produces: ["project-snapshot"],
      next: ["apply-approved-file-changes"],
    },
    {
      id: "apply-approved-file-changes",
      capabilityId: "apply-approved-file-changes",
      inputMap: all,
      execution: { dependsOn: ["create-project-snapshot"] },
      produces: ["file-application-result"],
      next: ["run-project-validation"],
    },
    {
      id: "run-project-validation",
      capabilityId: "run-project-validation",
      inputMap: all,
      execution: { dependsOn: ["apply-approved-file-changes"] },
      produces: ["implementation-validation"],
      next: ["store-finalization-result"],
    },
    {
      id: "store-finalization-result",
      capabilityId: "store-finalization-result",
      inputMap: all,
      execution: { dependsOn: ["run-project-validation"] },
      produces: ["v2-finalization-result"],
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["design", "flagship", "v2"],
  },
};

/**
 * The human approval gate for the flagship — the same policy mechanism the
 * V2-7 finalize stage proved: manual-only, bound to the exact proposal and
 * project-context artifacts, verified again at resume through the
 * authoritative binding verifier.
 */
export const designToCodeV2ApprovalPolicy: ExecutionPolicy = {
  id: "design-to-code-v2-approval",
  name: "Design Engineer approval",
  rules: [
    {
      id: "approve-v2-flagship-apply",
      type: "require_approval",
      target: { workflowId: DESIGN_TO_CODE_V2_WORKFLOW_ID, nodeId: "create-project-snapshot" },
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

/** Capabilities another package may already have registered in this host. */
const reusedCapabilities: readonly Capability<unknown, unknown>[] = [
  ...(sharedFigmaSpecificationCapabilities as readonly Capability<unknown, unknown>[]),
  storeImplementationApprovalCapability,
  createProjectSnapshotCapability,
  applyApprovedFileChangesCapability,
  validateImplementationCapability,
] as readonly Capability<unknown, unknown>[];

const ownedCapabilities: readonly Capability<unknown, unknown>[] = [
  ...flagshipCapabilities,
  runVisualConvergenceCapability,
  inspectFinalizationProjectCapability,
  resolveSelectedProposalCapability,
  storeFinalReviewCapability,
  storeFinalizationResultCapability,
] as readonly Capability<unknown, unknown>[];

export const designToCodeV2WorkflowPackage: WorkflowPackage = {
  id: DESIGN_TO_CODE_V2_WORKFLOW_ID,
  name: "Design Engineer",
  version: "0.1.0",
  description: "The flagship Design-to-Code architecture: Blueprint, Mapper, Builder, visual convergence, exact approval.",
  capabilities: [...reusedCapabilities, ...ownedCapabilities].map((capability) => capability.id),
  metadata: { author: "DesignFlow Team", tags: ["design", "flagship", "v2"] },
  definition: designToCodeV2Workflow,
  load(registry) {
    const has = (registry as { has?: (id: string) => boolean }).has?.bind(registry);
    for (const capability of ownedCapabilities) {
      if (has?.(capability.id) !== true) registry.register(capability);
    }
    // Shared with the legacy stage-4 package in the CLI host; registered here
    // only when that package is not installed alongside.
    for (const capability of reusedCapabilities) {
      if (has?.(capability.id) !== true) registry.register(capability);
    }
  },
};
