import type { WorkflowProvider } from "@designflow/sdk";
import { testWorkflowManifest } from "./manifest";

export const provider: WorkflowProvider = {
  getManifest() {
    return testWorkflowManifest;
  },
};

export { testArtifactCapability } from "./capability";
export { testWorkflow } from "./workflow";
export type { TestArtifactInput, TestArtifactOutput } from "./types";
