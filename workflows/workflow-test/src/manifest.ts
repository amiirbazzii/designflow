import type { WorkflowManifest } from "@designflow/sdk";
import { testWorkflow } from "./workflow";
import { testArtifactCapability } from "./capability";

export const testWorkflowManifest: WorkflowManifest = {
  id: "test-workflow",
  name: "Test Workflow",
  version: "0.1.0",
  definition: testWorkflow,
  load(registry) {
    registry.register(testArtifactCapability);
  },
};
