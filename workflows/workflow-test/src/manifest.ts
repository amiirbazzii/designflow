import type { WorkflowPackage } from "@designflow/sdk";
import { testWorkflow } from "./workflow";
import { testArtifactCapability } from "./capability";

export const testWorkflowManifest: WorkflowPackage = {
  id: "test-workflow",
  name: "Test Workflow",
  version: "0.1.0",
  description: "System verification workflow",
  capabilities: ["test-artifact"],
  metadata: {
    author: "DesignFlow Team",
    tags: ["test", "verification"],
  },
  definition: testWorkflow,
  load(registry) {
    registry.register(testArtifactCapability);
  },
};
