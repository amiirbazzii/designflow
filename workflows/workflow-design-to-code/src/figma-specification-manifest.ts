// workflows/workflow-design-to-code/src/figma-specification-manifest.ts
import type { WorkflowPackage } from "@designflow/sdk";
import { designToCodeFigmaSpecificationWorkflow } from "./figma-specification-workflow";
import { figmaSpecificationCapabilities } from "./figma-specification-capabilities";

/**
 * The installable package for `design-to-code-figma-specification`.
 *
 * Not loaded by `cli-runner.ts`'s default wiring and not referenced by the
 * Design Engineer worker manifest — see the Stage 3 ADR's experimental
 * rollout section for the explicit, opt-in path that does load it.
 */
export const designToCodeFigmaSpecificationWorkflowPackage: WorkflowPackage = {
  id: "design-to-code-figma-specification",
  name: "Design → Code (Figma Specification)",
  version: "0.1.0",
  description: "Real Figma MCP retrieval and design specification generation",
  capabilities: figmaSpecificationCapabilities.map((capability) => capability.id),
  metadata: {
    author: "DesignFlow Team",
    tags: ["design", "figma", "mcp", "stage-3", "experimental"],
  },
  definition: designToCodeFigmaSpecificationWorkflow,
  load(registry) {
    for (const capability of figmaSpecificationCapabilities) {
      registry.register(capability);
    }
  },
};
