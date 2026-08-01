// packages/sdk/src/index.ts
export const SDK_VERSION = "0.1.0";

export {
  capabilityTypeSchema,
  artifactRefSchema,
  artifactLineageSchema,
  executionContextSchema,
  workflowDefinitionSchema,
  workflowMetadataSchema,
  capabilityNodeSchema,
  workflowNodeSchema,
  workflowInputRefSchema,
  workflowStepNodeSchema,
  nodeExecutionOptionsSchema,
  isCapabilityNode,
  isWorkflowNode,
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
  WorkflowNode,
  WorkflowStepNode,
  WorkflowInputRef,
  NodeExecutionOptions,
  CheckpointRecord,
  ExecutionPhase,
  ExecutionCheckpoint,
  WorkflowManifest,
  SemanticVersion,
} from "./schemas";

// ── Worker Catalogue ────────────────────────────────────────────
export {
  workerManifestSchema,
  workerInputFieldSchema,
  primaryWorkflowOf,
} from "./worker-manifest";

export type {
  WorkerManifest,
  WorkerInputField,
  WorkerRegistry,
} from "./worker-manifest";

// ── Agents ──────────────────────────────────────────────────────
export {
  agentManifestSchema,
  agentTaskSchema,
  agentDecisionSchema,
  agentExecutionResultSchema,
  workerAgentWorkflowMismatch,
} from "./agent";

export type {
  Agent,
  AgentManifest,
  AgentTask,
  AgentDecision,
  AgentExecutionResult,
  AgentContext,
  AgentDecisionService,
} from "./agent";

// ── Model Runtime ────────────────────────────────────────────────
export {
  modelMessageRoleSchema,
  modelMessageSchema,
  jsonSchemaObjectSchema,
  modelProviderRoutingSchema,
  modelProfileSchema,
  modelUsageSchema,
  modelRequestSchema,
  modelResponseSchema,
  modelResultSchema,
} from "./model";

export type {
  ModelMessageRole,
  ModelMessage,
  JsonSchemaObject,
  ModelProviderRouting,
  ModelProfile,
  ModelUsage,
  ModelRequest,
  ModelResponse,
  ModelResult,
  ModelProviderContext,
  ModelProvider,
  ModelInvocationRequest,
  ModelInvoker,
  AgentModelRequest,
  AgentModelService,
} from "./model";

// ── Agent Tools ─────────────────────────────────────────────────
export {
  toolManifestSchema,
  toolCallSchema,
  toolResultSchema,
  toolSchemaDescriptorSchema,
  toolFieldDescriptorSchema,
  DEFAULT_TOOL_TIMEOUT_MS,
} from "./tool";

export type {
  Tool,
  ToolManifest,
  ToolCall,
  ToolResult,
  ToolContext,
  ToolSchemaDescriptor,
  ToolFieldDescriptor,
  AgentToolService,
  ToolInvoker,
  ToolInvocationRequest,
} from "./tool";

// ── Agent Observability ─────────────────────────────────────────
export {
  agentObservationSchema,
  NOOP_AGENT_OBSERVER,
  shapeOf,
} from "./agent-observability";

export type { AgentObservation, AgentObserver } from "./agent-observability";

// ── Agent Tracing ───────────────────────────────────────────────
export {
  agentTraceSchema,
  agentTracePatchSchema,
  traceEventSchema,
  traceToolCallSchema,
  traceModelCallSchema,
  traceStatusSchema,
  traceDecisionTypeSchema,
  traceFiltersSchema,
  NOOP_TRACE_OBSERVER,
  selectTraces,
} from "./trace";

export type {
  AgentTrace,
  AgentTracePatch,
  TraceEvent,
  TraceToolCall,
  TraceModelCall,
  TraceStatus,
  TraceDecisionType,
  TraceFilters,
  TraceObserver,
  TraceStore,
} from "./trace";

// ── Agent Sessions ──────────────────────────────────────────────
export {
  sessionStatusSchema,
  sessionAnswerSchema,
  sessionDecisionTypeSchema,
  agentSessionSchema,
  agentSessionPatchSchema,
  applySessionPatch,
  startSessionRequestSchema,
  answerSessionRequestSchema,
  cancelSessionRequestSchema,
  sessionListFilterSchema,
  sessionResultSchema,
  sessionEventSchema,
  NOOP_SESSION_OBSERVER,
  isValidSessionTransition,
  isTerminalSessionStatus,
  selectSessions,
} from "./session";

export type {
  SessionStatus,
  SessionAnswer,
  SessionDecisionType,
  AgentSession,
  AgentSessionPatch,
  StartSessionRequest,
  AnswerSessionRequest,
  CancelSessionRequest,
  SessionListFilter,
  SessionResult,
  SessionStore,
  SessionEvent,
  SessionObserver,
} from "./session";

export { DesignFlowError } from "./errors";

export type { CapabilityContext, Logger } from "./context";

export type { Capability, CapabilityPackage, CapabilityProvider } from "./capability";
export { capabilityPackageSchema, parseCapabilityPackage } from "./capability-manifest";

export { capabilityManifestSchema } from "./capability-manifest";
export type { CapabilityManifest } from "./capability-manifest";

export type { WorkflowProvider, WorkflowPackage, CapabilityRegistrar } from "./workflow";
export { workflowPackageSchema } from "./workflow";

export type {
  StateStore,
  ArtifactStore,
  RegistryArtifactStore,
  CheckpointState,
  CheckpointData,
} from "./state";

// ── Artifact System ─────────────────────────────────────────────
export {
  artifactSchema,
  artifactInputSchema,
  artifactVersionSchema,
  artifactRelationSchema,
  artifactRelationTypeSchema,
  artifactProvenanceSchema,
  artifactLineageGraphSchema,
} from "./artifact-system";

export type {
  Artifact,
  ArtifactInput,
  ArtifactVersion,
  ArtifactRelation,
  ArtifactRelationType,
  ArtifactProvenance,
  ArtifactLineageGraph,
  ArtifactRegistry,
} from "./artifact-system";

// ── Execution Reconciliation ────────────────────────────────────
export {
  artifactReconciliationInputSchema,
  artifactReconciliationResultSchema,
  reconciliationReportSchema,
} from "./execution-reconciliation";

export type {
  ArtifactReconciliationInput,
  ArtifactReconciliationResult,
  ReconciliationReport,
  ExecutionReconciler,
} from "./execution-reconciliation";

// ── Artifact Materialization ────────────────────────────────────
export {
  artifactMaterializationRequestSchema,
  artifactMaterializationResultSchema,
} from "./artifact-materialization";

export type {
  ArtifactMaterializationRequest,
  ArtifactMaterializationResult,
  ArtifactMaterializer,
} from "./artifact-materialization";

// ── Incremental Execution Planning ──────────────────────────────
export {
  incrementalExecutionPlanSchema,
  nodeImpactSchema,
  nodeImpactReasonSchema,
  executionPlanningRequestSchema,
  executionPlanningResultSchema,
  workflowGraphSchema,
  workflowGraphNodeSchema,
  readChangedArtifacts,
  withChangedArtifacts,
  CHANGED_ARTIFACTS_METADATA_KEY,
} from "./execution-plan";

export type {
  IncrementalExecutionPlan,
  NodeImpact,
  NodeImpactReason,
  ExecutionPlanningRequest,
  ExecutionPlanningResult,
  WorkflowGraph,
  WorkflowGraphNode,
  IncrementalExecutionPlanner,
} from "./execution-plan";

// ── Artifact Intelligence ───────────────────────────────────────
export {
  artifactDependencySchema,
  artifactImpactSchema,
  artifactDiffSchema,
  artifactMetadataChangesSchema,
  artifactVersionRefSchema,
  artifactReuseReasonSchema,
  artifactReuseCandidateSchema,
  artifactReuseReportSchema,
  capabilityReuseDecisionSchema,
} from "./artifact-intelligence";

export type {
  ArtifactDependency,
  ArtifactImpact,
  ArtifactDiff,
  ArtifactMetadataChanges,
  ArtifactVersionRef,
  ArtifactReuseReason,
  ArtifactReuseCandidate,
  ArtifactReuseReport,
  ArtifactIntelligence,
  IntelligentArtifactRegistry,
  CapabilityReuseRequest,
  CapabilityReuseDecision,
  CapabilityReuseResolver,
} from "./artifact-intelligence";

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
  policyViolationTypeSchema,
  executionPolicySchema,
  policyViolationSchema,
  policyEvaluationResultSchema,
  policyContextSchema,
} from "./execution-policy";

export type {
  PolicyRule,
  PolicyRuleType,
  PolicyViolationType,
  ExecutionPolicy,
  PolicyViolation,
  PolicyEvaluationResult,
  PolicyContext,
  PolicyEvaluator,
} from "./execution-policy";

// ── Approval ────────────────────────────────────────────────────
export {
  approvalStatusSchema,
  approvalRequestSchema,
  approvalDecisionSchema,
} from "./approval";

export type {
  ApprovalStatus,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalManager,
} from "./approval";

// ── Workflow Composition ────────────────────────────────────────
export {
  workflowInvocationSchema,
  workflowInvocationResultSchema,
  workflowInvocationStatusSchema,
  workflowInvocationContextSchema,
  compositionPathSchema,
  executionLineageSchema,
  childExecutionLineageSchema,
  childExecutionRequestSchema,
  readExecutionLineage,
  withExecutionLineage,
  readExecutionInput,
  withExecutionInput,
  pendingChildExecutionSchema,
  compositionCheckpointSchema,
  readCompositionCheckpoint,
  withCompositionCheckpoint,
  EXECUTION_LINEAGE_METADATA_KEY,
  EXECUTION_INPUT_METADATA_KEY,
  COMPOSITION_CHECKPOINT_METADATA_KEY,
} from "./workflow-composition";

export type {
  WorkflowInvocation,
  WorkflowInvocationResult,
  WorkflowInvocationStatus,
  WorkflowInvocationContext,
  WorkflowExecutionResolver,
  ExecutionLineage,
  ChildExecutionLineage,
  ChildExecutionRequest,
  ChildExecutionContract,
  PendingChildExecution,
  CompositionCheckpoint,
} from "./workflow-composition";