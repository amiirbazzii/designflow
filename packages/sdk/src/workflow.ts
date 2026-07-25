import type { WorkflowManifest } from "./manifest";

export interface WorkflowProvider {
  getManifest(): WorkflowManifest;
}

export type {
  WorkflowDefinition,
  WorkflowMetadata,
  CapabilityNode,
} from "./schemas";
export {
  workflowDefinitionSchema,
  workflowMetadataSchema,
  capabilityNodeSchema,
} from "./schemas";