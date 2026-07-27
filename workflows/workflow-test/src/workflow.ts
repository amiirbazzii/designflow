// workflows/workflow-test/src/workflow.ts
import type { WorkflowDefinition } from "@designflow/sdk";

export const testWorkflow: WorkflowDefinition = {
  id: "test-workflow",
  name: "Test Workflow",
  description: "System verification workflow testing Capability → Registry → Compiler → ExecutionEngine → Validation → Apply",
  nodes: [
    {
      id: "create-artifact",
      capabilityId: "test-artifact",
      inputMap: {
        message: "hello from test workflow",
      },
      next: [],
    },
  ],
  metadata: {
    tags: [],
  },
};
