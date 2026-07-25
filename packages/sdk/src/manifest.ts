import type { Capability } from "./capability";
import type { WorkflowDefinition, WorkflowManifestMetadata } from "./schemas";

export interface CapabilityRegistrar {
  register<TInput, TOutput>(capability: Capability<TInput, TOutput>): void;
}

export interface WorkflowManifest extends WorkflowManifestMetadata {
  definition: WorkflowDefinition;
  load(registry: CapabilityRegistrar): void;
}
