import { testWorkflowManifest } from "@designflow/workflow-test";
import { WorkflowRegistry } from "./registry";

export function createWorkflowLoader(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.register(testWorkflowManifest);
  return registry;
}
