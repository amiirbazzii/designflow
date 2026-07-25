export const SDK_VERSION = "0.1.0";

export {
  capabilityTypeSchema,
  artifactRefSchema,
  artifactLineageSchema,
  executionContextSchema,
  workflowDefinitionSchema,
  workflowMetadataSchema,
  capabilityNodeSchema,
  saveCheckpointPayloadSchema,
  checkpointRecordSchema,
  executionPhaseSchema,
  executionCheckpointSchema,
  errorMetadataSchema,
  workflowManifestSchema,
  semanticVersionSchema,
} from "./schemas";

export type {
  CapabilityType,
  ArtifactRef,
  ArtifactLineage,
  ExecutionContext,
  WorkflowDefinition,
  WorkflowMetadata,
  CapabilityNode,
  CheckpointRecord,
  ExecutionPhase,
  ExecutionCheckpoint,
  WorkflowManifest,
  SemanticVersion,
} from "./schemas";

export { DesignFlowError } from "./errors";

export type { CapabilityContext, Logger } from "./context";

export type { Capability } from "./capability";

export type { WorkflowProvider, WorkflowPackage, CapabilityRegistrar } from "./workflow";
export { workflowPackageSchema } from "./workflow";

export type { StateStore, ArtifactStore, CheckpointState, CheckpointData } from "./state";