// workflows/workflow-design-to-code/src/manifest.ts
import type { WorkflowPackage } from "@designflow/sdk";
import { designToCodeWorkflow } from "../orchestration/workflow";
import { designToCodeCapabilities } from "../capabilities";

/**
 * The installable package.
 *
 * `load` registers the workflow's capabilities into whatever registry the host
 * hands it. That inversion is what keeps this package free of any engine
 * import: it never looks up a registry, it is given one.
 */
export const designToCodeWorkflowPackage: WorkflowPackage = {
  id: "design-to-code",
  name: "Design → Code",
  version: "0.1.0",
  description: "Legacy artifacts-only design scaffold (a structural prototype; writes no project files)",
  capabilities: designToCodeCapabilities.map((capability) => capability.id),
  metadata: {
    author: "DesignFlow Team",
    tags: ["design", "codegen", "incremental"],
  },
  definition: designToCodeWorkflow,
  load(registry) {
    for (const capability of designToCodeCapabilities) {
      registry.register(capability);
    }
  },
};
