// workflows/workflow-design-to-code/src/visual-convergence/visual-convergence-workflow.ts
import type { WorkflowDefinition, WorkflowPackage } from "@designflow/sdk";

import {
  storeBuilderProposalCapability,
  storeImplementationMapCapability,
  storeProjectContextCapability,
  storeUIBlueprintCapability,
} from "../v2-visual/v2-visual-capabilities";
import { runVisualConvergenceCapability } from "./visual-convergence-capability";

/**
 * The internal V2 convergence stage.
 *
 * Seeds the same canonical inputs as the V2-5.1 visual stage, then runs the
 * bounded render→evaluate→repair loop inside one deterministic capability.
 * Internal on purpose: the flagship `designflow run design-engineer` path is
 * unchanged, and no approval or apply exists anywhere in this workflow —
 * V2-7 owns those.
 */
export const designToCodeV2ConvergenceWorkflow: WorkflowDefinition = {
  id: "design-to-code-v2-convergence",
  name: "Design → Code (V2 bounded visual convergence)",
  description: "Renders, evaluates and repairs a validated V2 proposal within a bounded pre-approval loop.",
  nodes: [
    {
      id: "store-v2-ui-blueprint",
      capabilityId: "store-v2-ui-blueprint",
      inputMap: { $workflowInput: true },
      produces: ["ui-blueprint"],
      next: ["store-v2-project-context"],
    },
    {
      id: "store-v2-project-context",
      capabilityId: "store-v2-project-context",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["store-v2-ui-blueprint"] },
      produces: ["project-context"],
      next: ["store-v2-implementation-map"],
    },
    {
      id: "store-v2-implementation-map",
      capabilityId: "store-v2-implementation-map",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["store-v2-project-context"] },
      produces: ["implementation-map"],
      next: ["store-v2-builder-proposal"],
    },
    {
      id: "store-v2-builder-proposal",
      capabilityId: "store-v2-builder-proposal",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["store-v2-implementation-map"] },
      produces: ["builder-proposal"],
      next: ["run-visual-convergence"],
    },
    {
      id: "run-visual-convergence",
      capabilityId: "run-visual-convergence",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["store-v2-builder-proposal"] },
      produces: ["visual-convergence"],
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["v2", "visual-convergence", "pre-approval", "internal"],
  },
};

const capabilities = [
  storeUIBlueprintCapability,
  storeProjectContextCapability,
  storeImplementationMapCapability,
  storeBuilderProposalCapability,
  runVisualConvergenceCapability,
];

export const designToCodeV2ConvergenceWorkflowPackage: WorkflowPackage = {
  id: "design-to-code-v2-convergence",
  name: "Design → Code (V2 bounded visual convergence)",
  version: "0.1.0",
  description: "Internal V2 stage: bounded pre-approval visual convergence with deterministic candidate selection.",
  capabilities: capabilities.map((capability) => capability.id),
  metadata: { author: "DesignFlow Team", tags: ["v2", "visual-convergence", "internal"] },
  definition: designToCodeV2ConvergenceWorkflow,
  load(registry) {
    for (const capability of capabilities) registry.register(capability);
  },
};
