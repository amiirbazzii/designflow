// workflows/workflow-design-to-code/src/agent-foundation-workflow.ts
import type { WorkflowDefinition } from "@designflow/sdk";

/**
 * Design → Code, Agent Foundation.
 *
 * A separate, internal workflow proving specialized-agent invocation and
 * typed artifact handoff — not the public `design-to-code` workflow, and not
 * reachable from the Design Engineer worker's `workflows` list. See
 * `agent-foundation-types.ts`'s module doc for why this exists as its own
 * workflow rather than a modification of the one Stage 1 verified.
 *
 * Every `inputMap` here is deliberately narrow, for the same reason
 * `workflow.ts`'s are: a node's resolved input is what its reuse fingerprint
 * hashes, so a node names only the workflow-input fields it actually reads.
 * The large payloads (the Figma snapshot, the design specification, the
 * generated implementation) travel as artifacts through `dependsOn`, never
 * through `inputMap` — only "which agent version and model profile is this
 * invocation using" travels as input, which is exactly what should
 * invalidate reuse when it changes and nothing else.
 */
export const designToCodeAgentFoundationWorkflow: WorkflowDefinition = {
  id: "design-to-code-agent-foundation",
  name: "Design → Code (Agent Foundation)",
  description:
    "Proves specialized-agent invocation and typed artifact handoff for the Design Engineer worker",
  nodes: [
    {
      id: "prepare-figma-source-fixture",
      capabilityId: "prepare-figma-source-fixture",
      inputMap: { $workflowInput: "figmaSnapshotSeed" },
      produces: ["figma-source-snapshot"],
      next: ["invoke-figma-specification-agent"],
    },
    {
      id: "invoke-figma-specification-agent",
      capabilityId: "invoke-figma-specification-agent",
      inputMap: {
        agentVersion: { $workflowInput: "figmaAgentVersion" },
        modelProfileId: { $workflowInput: "figmaAgentModelProfileId" },
      },
      produces: ["design-specification"],
      execution: { dependsOn: ["prepare-figma-source-fixture"] },
      next: ["invoke-implementation-agent"],
    },
    {
      id: "invoke-implementation-agent",
      capabilityId: "invoke-implementation-agent",
      inputMap: {
        agentVersion: { $workflowInput: "implementationAgentVersion" },
        modelProfileId: { $workflowInput: "implementationAgentModelProfileId" },
        projectContext: { $workflowInput: "projectContext" },
      },
      produces: ["generated-implementation"],
      execution: { dependsOn: ["invoke-figma-specification-agent"] },
      next: ["invoke-visual-validation-agent"],
    },
    {
      id: "invoke-visual-validation-agent",
      capabilityId: "invoke-visual-validation-agent",
      inputMap: {
        agentVersion: { $workflowInput: "visualValidationAgentVersion" },
        modelProfileId: { $workflowInput: "visualValidationAgentModelProfileId" },
        threshold: { $workflowInput: "validationThreshold" },
      },
      produces: ["visual-validation-report"],
      execution: { dependsOn: ["invoke-implementation-agent"] },
      next: ["store-stage-2-summary"],
    },
    {
      id: "store-stage-2-summary",
      capabilityId: "store-stage-2-summary",
      inputMap: {},
      produces: ["stage-2-summary"],
      execution: { dependsOn: ["invoke-visual-validation-agent"] },
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["design", "codegen", "agents", "stage-2"],
  },
};
