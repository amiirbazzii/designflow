export const SDK_VERSION = "0.1.0";

export {
  capabilityTypeSchema,
  artifactRefSchema,
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
} from "./schemas";

export type {
  CapabilityType,
  ArtifactRef,
  ExecutionContext,
  WorkflowDefinition,
  WorkflowMetadata,
  CapabilityNode,
  CheckpointRecord,
  ExecutionPhase,
  ExecutionCheckpoint,
  WorkflowManifestMetadata,
} from "./schemas";

export { DesignFlowError } from "./errors";

export type { CapabilityContext, Logger } from "./context";

export type { Capability } from "./capability";

export type { WorkflowProvider, WorkflowManifest, CapabilityRegistrar } from "./workflow";

export type { StateStore, ArtifactStore, CheckpointState } from "./state";