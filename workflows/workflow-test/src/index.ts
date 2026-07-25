import type { WorkflowProvider, WorkflowPackage } from "@designflow/sdk";
import { testWorkflowManifest } from "./manifest";

export const provider: WorkflowProvider = {
  getManifest(): WorkflowPackage {
    return testWorkflowManifest;
  },
};

export { testArtifactCapability } from "./capability";
export { testWorkflow } from "./workflow";
export type { TestArtifactInput, TestArtifactOutput } from "./types";
