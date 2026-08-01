// workflows/workflow-product-brief/src/manifest.ts
import type { WorkflowPackage } from "@designflow/sdk";
import { productBriefWorkflow } from "./workflow";
import { productBriefCapabilities } from "./capabilities";

/**
 * The installable package.
 *
 * `load` registers the workflow's capabilities into whatever registry the host
 * hands it. That inversion is what keeps this package free of any engine
 * import: it never looks up a registry, it is given one.
 */
export const productBriefWorkflowPackage: WorkflowPackage = {
  id: "product-brief",
  name: "Product Brief",
  version: "0.1.0",
  description: "Turn a product request into a structured, typed product brief",
  capabilities: productBriefCapabilities.map((capability) => capability.id),
  metadata: {
    author: "DesignFlow Team",
    tags: ["product", "planning", "incremental"],
  },
  definition: productBriefWorkflow,
  load(registry) {
    for (const capability of productBriefCapabilities) {
      registry.register(capability);
    }
  },
};
