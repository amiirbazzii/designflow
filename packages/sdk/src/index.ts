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

export type { Capability, CapabilityPackage, CapabilityProvider } from "./capability";
export { capabilityPackageSchema, parseCapabilityPackage } from "./capability-manifest";

export { capabilityManifestSchema } from "./capability-manifest";
export type { CapabilityManifest } from "./capability-manifest";

export type { WorkflowProvider, WorkflowPackage, CapabilityRegistrar } from "./workflow";
export { workflowPackageSchema } from "./workflow";

export type { StateStore, ArtifactStore, CheckpointState, CheckpointData } from "./state";

// ── Execution Repository ────────────────────────────────────────
export {
  executionRecordSchema,
  executionRecordStatusSchema,
  lifecycleEventSchema,
  lifecycleEventPhaseSchema,
  executionCheckpointDataSchema,
} from "./execution-repository";

export type {
  ExecutionRecord,
  ExecutionRecordStatus,
  LifecycleEvent,
  LifecycleEventPhase,
  ExecutionCheckpointData,
  ExecutionRepository,
} from "./execution-repository";

// ── Execution Contract ───────────────────────────────────────────
export {
  executionRequestSchema,
  executionRequestOptionsSchema,
  executionResultSchema,
  executionErrorSchema,
} from "./execution-contract";

export type {
  ExecutionRequest,
  ExecutionRequestOptions,
  ExecutionResult,
  ExecutionErrorDetail,
  ExecutionContract,
} from "./execution-contract";

// ── Execution Events ────────────────────────────────────────────
export {
  executionEventSchema,
  executionEventTypeSchema,
} from "./execution-events";

export type {
  ExecutionEvent,
  ExecutionEventType,
  ExecutionEventHandler,
  ExecutionEventPublisher,
} from "./execution-events";

// ── Execution Policy ────────────────────────────────────────────
export {
  policyRuleSchema,
  policyRuleTypeSchema,
  executionPolicySchema,
  policyViolationSchema,
  policyEvaluationResultSchema,
  policyContextSchema,
} from "./execution-policy";

export type {
  PolicyRule,
  PolicyRuleType,
  ExecutionPolicy,
  PolicyViolation,
  PolicyEvaluationResult,
  PolicyContext,
  PolicyEvaluator,
} from "./execution-policy";