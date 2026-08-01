// workflows/workflow-qa-review/src/manifest.ts
import type { WorkflowPackage } from "@designflow/sdk";
import { qaReviewWorkflow } from "./workflow";
import { qaReviewCapabilities } from "./capabilities";

/**
 * The installable package.
 *
 * `load` registers the workflow's capabilities into whatever registry the
 * host hands it. That inversion is what keeps this package free of any
 * engine import: it never looks up a registry, it is given one.
 */
export const qaReviewWorkflowPackage: WorkflowPackage = {
  id: "qa-review",
  name: "QA Review",
  version: "0.1.0",
  description: "Review a supplied implementation for correctness, severity, and accessibility",
  capabilities: qaReviewCapabilities.map((capability) => capability.id),
  metadata: {
    author: "DesignFlow Team",
    tags: ["qa", "review", "incremental"],
  },
  definition: qaReviewWorkflow,
  load(registry) {
    for (const capability of qaReviewCapabilities) {
      registry.register(capability);
    }
  },
};
