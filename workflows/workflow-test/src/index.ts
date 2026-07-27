// workflows/workflow-test/src/index.ts
import type { WorkflowProvider, WorkflowPackage } from "@designflow/sdk";
import { testWorkflowManifest } from "./manifest";

export const provider: WorkflowProvider = {
  getManifest(): WorkflowPackage {
    return testWorkflowManifest;
  },
};

export { testWorkflow } from "./workflow";
