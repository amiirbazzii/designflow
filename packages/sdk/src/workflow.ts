import { z } from "zod";
import type { Capability } from "./capability";
import { workflowDefinitionSchema } from "./schemas";
import { workflowManifestSchema } from "./workflow-manifest";
import type { WorkflowManifest } from "./workflow-manifest";

export interface CapabilityRegistrar {
  register<TInput, TOutput>(capability: Capability<TInput, TOutput>): void;
}

export interface WorkflowPackage extends WorkflowManifest {
  definition: z.infer<typeof workflowDefinitionSchema>;
  load(registry: CapabilityRegistrar): void;
}

export const workflowPackageSchema = z.intersection(
  workflowManifestSchema,
  z.object({
    definition: workflowDefinitionSchema,
  }),
);

export interface WorkflowProvider {
  getManifest(): WorkflowPackage;
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

export type { WorkflowManifest } from "./workflow-manifest";
export { workflowManifestSchema, semanticVersionSchema } from "./workflow-manifest";