import type { WorkflowRegistry } from "./registry";
import { discoverWorkflows } from "./discovery";

export async function createWorkflowLoader(): Promise<WorkflowRegistry> {
  return discoverWorkflows();
}
