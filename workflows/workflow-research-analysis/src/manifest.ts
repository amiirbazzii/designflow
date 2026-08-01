// workflows/workflow-research-analysis/src/manifest.ts
import type { WorkflowPackage } from "@designflow/sdk";
import { researchAnalysisWorkflow } from "./workflow";
import { researchAnalysisCapabilities } from "./capabilities";

/**
 * The installable package.
 *
 * `load` registers the workflow's capabilities into whatever registry the
 * host hands it. That inversion is what keeps this package free of any
 * engine import: it never looks up a registry, it is given one.
 */
export const researchAnalysisWorkflowPackage: WorkflowPackage = {
  id: "research-analysis",
  name: "Research Analysis",
  version: "0.1.0",
  description:
    "Turn a research question and a bounded set of supplied sources into a cited research brief",
  capabilities: researchAnalysisCapabilities.map((capability) => capability.id),
  metadata: {
    author: "DesignFlow Team",
    tags: ["research", "analysis", "deterministic"],
  },
  definition: researchAnalysisWorkflow,
  load(registry) {
    for (const capability of researchAnalysisCapabilities) {
      registry.register(capability);
    }
  },
};
