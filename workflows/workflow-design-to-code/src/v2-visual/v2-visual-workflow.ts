// workflows/workflow-design-to-code/src/v2-visual/v2-visual-workflow.ts
import type { WorkflowDefinition, WorkflowPackage } from "@designflow/sdk";

import { v2VisualCapabilities } from "./v2-visual-capabilities";

/**
 * The internal V2 pre-approval visual stage.
 *
 * Internal, and marked so: the flagship `designflow run design-engineer` path
 * is unchanged and still V1. This workflow exists so the V2 chain can actually
 * be executed end to end and leave resolvable artifacts behind.
 *
 * It deliberately stops at a persisted report. No approval, no apply, no
 * repair iteration — that is V2-6, and a stage that could quietly change files
 * would need an entirely different set of guarantees than this one has.
 */
export const designToCodeV2VisualWorkflow: WorkflowDefinition = {
  id: "design-to-code-v2-visual",
  name: "Design → Code (V2 pre-approval visual evaluation)",
  description: "Renders a validated V2 proposal in isolation and evaluates it against the canonical Blueprint.",
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
      next: ["render-proposed-state"],
    },
    {
      id: "render-proposed-state",
      capabilityId: "render-proposed-state",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["store-v2-builder-proposal"] },
      produces: ["rendered-state"],
      next: ["evaluate-visual-delta"],
    },
    {
      id: "evaluate-visual-delta",
      capabilityId: "evaluate-visual-delta",
      inputMap: { $workflowInput: true },
      execution: { dependsOn: ["render-proposed-state"] },
      produces: ["visual-delta-report"],
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["v2", "visual-evaluation", "pre-approval", "internal"],
  },
};

export const designToCodeV2VisualWorkflowPackage: WorkflowPackage = {
  id: "design-to-code-v2-visual",
  name: "Design → Code (V2 pre-approval visual evaluation)",
  version: "0.1.0",
  description: "Internal V2 stage: isolated proposed-state render and Blueprint-aware visual evaluation.",
  capabilities: v2VisualCapabilities.map((capability) => capability.id),
  metadata: { author: "DesignFlow Team", tags: ["v2", "visual-evaluation", "internal"] },
  definition: designToCodeV2VisualWorkflow,
  load(registry) {
    for (const capability of v2VisualCapabilities) registry.register(capability);
  },
};
