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

export {
  workerEvaluationCriterionSchema,
} from "./worker-evaluation";
export type { WorkerEvaluationCriterion } from "./worker-evaluation";

export {
  workerResultSchema,
  workerResultOutputSchema,
  workerResultStatusSchema,
  workerEvaluationSummarySchema,
  workerEvaluationResultSchema,
} from "./worker-result";
export type {
  WorkerResult,
  WorkerResultOutput,
  WorkerResultStatus,
  WorkerEvaluationSummary,
  WorkerEvaluationResult,
} from "./worker-result";

export {
  isPresent,
  payloadOf,
  cannotDecide,
  decided,
} from "./worker-evaluation-helpers";
export type {
  EvaluableArtifact,
  ArtifactPayloadReader,
  WorkerCriterionEvaluator,
} from "./worker-evaluation-helpers";

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
  modelCandidateAttemptSchema,
  modelCandidateSelectionSchema,
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
  ModelCandidateAttempt,
  ModelCandidateSelection,
  ModelProviderContext,
  ModelProviderCapabilities,
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
  traceModelCandidateAttemptSchema,
  traceEvidenceMetricsSchema,
  coordinatorOutputDiagnosticSchema,
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
  TraceModelCandidateAttempt,
  TraceEvidenceMetrics,
  CoordinatorOutputDiagnostic,
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
  isSessionExpired,
  effectiveSessionStatus,
  withEffectiveSessionStatus,
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

// ── Projects ────────────────────────────────────────────────────
export {
  projectIdentitySchema,
  createProjectRequestSchema,
  projectPatchSchema,
  projectListFilterSchema,
  selectProjects,
} from "./project";

export type {
  ProjectIdentity,
  CreateProjectRequest,
  ProjectPatch,
  ProjectListFilter,
  ProjectStore,
} from "./project";

// ── Project Context ─────────────────────────────────────────────
export {
  projectFactSourceSchema,
  projectFactSchema,
  projectFactInputSchema,
  projectFactChangeSchema,
  projectContextSchema,
  projectContextSourceMetadataSchema,
  applyProjectFactChanges,
} from "./project-context";

export type {
  ProjectFactSource,
  ProjectFact,
  ProjectFactInput,
  ProjectFactChange,
  ProjectContext,
  ProjectContextStore,
} from "./project-context";

// ── Canonical Project Context (Agent Architecture V2) ────────────
export {
  CANONICAL_PROJECT_CONTEXT_SCHEMA_VERSION,
  PROJECT_CONTEXT_ARTIFACT_ID,
  PROJECT_CONTEXT_ARTIFACT_TYPE,
  projectEvidenceSourceSchema,
  projectEvidenceConfidenceSchema,
  projectProvenanceSchema,
  evidencedValueSchema,
  projectBoundSchema,
  projectRuntimeSchema,
  projectAliasSchema,
  projectStructureSchema,
  projectRoutingKindSchema,
  projectRoutingSchema,
  projectDestinationSchema,
  projectStylingSchema,
  projectTokenSchema,
  projectDesignSystemSchema,
  projectComponentSchema,
  projectCommandSchema,
  projectTestingSchema,
  projectCapabilitiesSchema,
  projectConventionSchema,
  canonicalProjectContextSchema,
} from "./project-context";

export type {
  ProjectEvidenceSource,
  ProjectEvidenceConfidence,
  ProjectProvenance,
  ProjectBound,
  ProjectAlias,
  ProjectDestination,
  ProjectComponent,
  CanonicalProjectContext,
} from "./project-context";

export {
  projectEventSchema,
  NOOP_PROJECT_OBSERVER,
} from "./project-events";

export type { ProjectEvent, ProjectObserver } from "./project-events";

// ── Agent Memory ────────────────────────────────────────────────
export {
  memoryScopeSchema,
  memorySourceSchema,
  memoryStatusSchema,
  agentMemorySchema,
  memoryListFilterSchema,
  selectMemory,
  memoryProposalStatusSchema,
  memoryProposalSchema,
  memoryProposalListFilterSchema,
  selectMemoryProposals,
} from "./memory";

export type {
  MemoryScope,
  MemorySource,
  MemoryStatus,
  AgentMemory,
  MemoryListFilter,
  AgentMemoryStore,
  MemoryProposalStatus,
  MemoryProposal,
  MemoryProposalListFilter,
  MemoryProposalStore,
} from "./memory";

export {
  memoryEventSchema,
  NOOP_MEMORY_OBSERVER,
} from "./memory-events";

export type { MemoryEvent, MemoryObserver } from "./memory-events";

// ── Privacy ─────────────────────────────────────────────────────
export { looksSecretLike, valueLooksSecretLike } from "./privacy";

export { DesignFlowError } from "./errors";

export type { CapabilityContext, Logger } from "./context";

// ── Specialized Agent Invocation ────────────────────────────────
export {
  agentInvocationRequestSchema,
  agentInvocationOutcomeSchema,
} from "./agent-invocation";

export type {
  AgentInvocationRequest,
  AgentInvocationOutcome,
  SpecializedAgentContext,
  SpecializedAgent,
  AgentInvocationService,
} from "./agent-invocation";

// ── Model Context Protocol (generic port) ───────────────────────
export {
  mcpToolDescriptorSchema,
  mcpToolCallRequestSchema,
  mcpToolCallResultSchema,
} from "./mcp";

export type {
  McpToolDescriptor,
  McpToolCallRequest,
  McpToolCallResult,
  McpClient,
} from "./mcp";

// ── Design Engineer Contracts ───────────────────────────────────
export {
  DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION,
  FIGMA_SOURCE_SNAPSHOT_SCHEMA_VERSION,
  DESIGN_SPECIFICATION_SCHEMA_VERSION,
  figmaNodeSnapshotSchema,
  figmaVariableSnapshotSchema,
  figmaStyleSnapshotSchema,
  figmaComponentSnapshotSchema,
  figmaAssetSnapshotSchema,
  figmaScreenshotSnapshotSchema,
  figmaSnapshotWarningSchema,
  figmaSourceSnapshotSchema,
  figmaSourceProvenanceSchema,
  designSpecificationAmbiguitySchema,
  designSpecificationComponentSchema,
  designSpecificationSchema,
  specTypographySchema,
  specLayoutSchema,
  specElementSchema,
  specRegionSchema,
  specEvidenceSourceSchema,
  specComponentPropertySchema,
  specComponentVariantSchema,
  specComponentInstanceSchema,
  specComponentContractSchema,
  specFoundationValueSchema,
  specFoundationsSchema,
  specScreenSchema,
  specAssetDetailSchema,
  collectSpecificationVisibleContent,
  projectImplementationContextSchema,
  implementationPlanSchema,
  generatedImplementationSchema,
  implementationCoverageClaimSchema,
  implementationCoveragePlanV1Schema,
  MAX_IMPLEMENTATION_COVERAGE_TARGETS,
  visualValidationDiscrepancySchema,
  visualValidationReportSchema,
  revisionRequestSchema,
} from "./design-engineer/design-engineer-contracts";

export {
  VISUAL_VALIDATION_SCHEMA_VERSION,
  visualViewportV1Schema,
  safePreviewCommandV1Schema,
  previewConfigurationV1Schema,
  captureConfigurationV1Schema,
  visualValidationInputV1Schema,
  previewTargetV1Schema,
  screenshotEvidenceV1Schema,
  visualFindingCategoryV1Schema,
  visualFindingSeverityV1Schema,
  visualFindingStatusV1Schema,
  visualFindingV1Schema,
  viewportValidationResultV1Schema,
  visualValidationReportV1Schema,
  visualValidationInconclusivePhaseSchema,
  visualValidationInconclusiveReasonSchema,
  visualValidationAgentOutputV1Schema,
} from "./visual-validation/visual-validation-contracts";

export {
  RENDERED_STATE_SCHEMA_VERSION,
  VISUAL_DELTA_REPORT_SCHEMA_VERSION,
  RENDERED_STATE_ARTIFACT_ID,
  RENDERED_STATE_ARTIFACT_TYPE,
  VISUAL_DELTA_REPORT_ARTIFACT_ID,
  VISUAL_DELTA_REPORT_ARTIFACT_TYPE,
  VISUAL_CRITIC_FORBIDDEN_FIELDS,
  DEFAULT_VISUAL_PASS_FAIL_POLICY,
  renderedStateBindingSchema,
  renderedViewportSchema,
  renderedElementEvidenceSchema,
  renderedStateStatusSchema,
  renderedStateSchema,
  correspondenceStateSchema,
  correspondenceSignalSchema,
  elementCorrespondenceSchema,
  pixelComparisonStatusSchema,
  pixelComparisonSchema,
  expectationAnchorSchema,
  visualExpectationKindSchema,
  visualExpectationSchema,
  visualCriticAnnotationSchema,
  visualCriticPatchSchema,
  visualOutcomeSchema,
  visualDeltaReportSchema,
} from "./visual-validation/rendered-state-contracts";

export type {
  RenderedState,
  RenderedStateStatus,
  RenderedViewport,
  RenderedElementEvidence,
  CorrespondenceState,
  CorrespondenceSignal,
  ElementCorrespondence,
  PixelComparison,
  PixelComparisonStatus,
  ExpectationAnchor,
  VisualExpectation,
  VisualCriticAnnotation,
  VisualCriticPatch,
  VisualOutcome,
  VisualDeltaReport,
} from "./visual-validation/rendered-state-contracts";

export {
  VISUAL_CONVERGENCE_SCHEMA_VERSION,
  VISUAL_CONVERGENCE_ARTIFACT_ID,
  VISUAL_CONVERGENCE_ARTIFACT_TYPE,
  VISUAL_CONVERGENCE_LIMITS,
  visualConvergenceStatusSchema,
  visualConvergenceStopReasonSchema,
  findingDeltaStateSchema,
  findingComparisonEntrySchema,
  iterationComparisonSchema,
  iterationQualitySchema,
  convergenceIterationSchema,
  visualConvergenceMetricsSchema,
  visualConvergenceArtifactSchema,
} from "./visual-convergence/visual-convergence-contracts";

export type {
  VisualConvergenceStatus,
  VisualConvergenceStopReason,
  FindingDeltaState,
  FindingComparisonEntry,
  IterationComparison,
  IterationQuality,
  ConvergenceIteration,
  VisualConvergenceMetrics,
  VisualConvergenceArtifact,
} from "./visual-convergence/visual-convergence-contracts";

export {
  VISUAL_CORRECTION_SCHEMA_VERSION,
  VISUAL_CORRECTION_AGENT_ID,
  VISUAL_CORRECTION_AGENT_VERSION,
  FEEDBACK_LOOP_HARD_LIMITS,
  MAX_CORRECTION_COMPOSITION_FILES,
  compositionScopeEntrySchema,
  feedbackLoopStopReasonSchema,
  feedbackLoopInputV1Schema,
  correctionContextV1Schema,
  correctionPlanV1Schema,
  proposedCorrectionChangeV1Schema,
  correctionAgentOutputV1Schema,
  correctionApprovalBindingV1Schema,
  feedbackLoopIterationV1Schema,
  feedbackLoopReportV1Schema,
} from "./visual-correction/visual-correction-contracts";

export {
  feedbackLoopParentStateSchema,
  feedbackLoopParentChildStatusSchema,
  feedbackLoopParentSideEffectSchema,
  feedbackLoopParentIterationSchema,
  feedbackLoopParentRecordV1Schema,
  feedbackLoopParentReportV1Schema,
} from "./visual-correction/feedback-loop-parent-contracts";
export {
  STAGE6_FAILPOINT_EXIT_CODE,
  stage6FailpointSchema,
  stage6FailpointEnabled,
  terminateAtStage6Failpoint,
  stage6FailpointForNode,
} from "./stage6-failpoint";
export type { Stage6Failpoint } from "./stage6-failpoint";

export type {
  FeedbackLoopParentState,
  FeedbackLoopParentRecordV1,
  FeedbackLoopParentReportV1,
} from "./visual-correction/feedback-loop-parent-contracts";

export type {
  FeedbackLoopStopReason,
  FeedbackLoopIterationPolicy,
  FeedbackLoopInputV1,
  CompositionScopeEntry,
  CorrectionContextV1,
  CorrectionPlanV1,
  ProposedCorrectionChangeV1,
  CorrectionAgentOutputV1,
  CorrectionApprovalBindingV1,
  FeedbackLoopIterationV1,
  FeedbackLoopReportV1,
} from "./visual-correction/visual-correction-contracts";

export type {
  VisualViewportV1,
  SafePreviewCommandV1,
  PreviewConfigurationV1,
  CaptureConfigurationV1,
  VisualValidationInputV1,
  PreviewTargetV1,
  ScreenshotEvidenceV1,
  VisualFindingV1,
  ViewportValidationResultV1,
  VisualValidationReportV1,
  VisualValidationInconclusivePhase,
  VisualValidationInconclusiveReason,
  VisualValidationAgentOutputV1,
} from "./visual-validation/visual-validation-contracts";

export {
  STAGE4_SCHEMA_VERSION,
  projectInspectionWarningSchema,
  tokenSourceReferenceSchema,
  normalizedProjectTokenSchema,
  componentSourceReferenceSchema,
  existingComponentReferenceSchema,
  safeProjectCommandSchema,
  projectImplementationContextV1Schema,
  designSystemMappingSchema,
  implementationPlanV1Schema,
  safeProjectCommandReferenceSchema,
  proposedFileChangesSchema,
  proposalV2BindingSchema,
  implementationApprovalBindingSchema,
  implementationValidationReportSchema,
  generatedImplementationV1Schema,
} from "./implementation/stage4-contracts";

export type {
  ProjectInspectionWarning,
  TokenSourceReference,
  NormalizedProjectToken,
  ComponentSourceReference,
  ExistingComponentReference,
  SafeProjectCommand,
  ProjectImplementationContext as Stage4ProjectImplementationContext,
  DesignSystemMapping,
  ImplementationPlanV1,
  ProposedFileChanges,
  ProposalV2Binding,
  ImplementationApprovalBinding,
  ImplementationValidationReport,
  GeneratedImplementationV1,
} from "./implementation/stage4-contracts";

export type {
  FigmaNodeSnapshot,
  FigmaVariableSnapshot,
  FigmaStyleSnapshot,
  FigmaComponentSnapshot,
  FigmaAssetSnapshot,
  FigmaScreenshotSnapshot,
  FigmaSnapshotWarning,
  FigmaSourceProvenance,
  FigmaSourceSnapshot,
  DesignSpecificationAmbiguity,
  DesignSpecificationComponent,
  DesignSpecification,
  SpecTypography,
  SpecLayout,
  SpecElement,
  SpecRegion,
  SpecComponentContract,
  SpecFoundations,
  SpecScreen,
  SpecAssetDetail,
  SpecVisibleContent,
  ProjectImplementationContext,
  ImplementationPlan,
  GeneratedImplementation,
  ImplementationCoverageClaim,
  ImplementationCoveragePlanV1,
  VisualValidationDiscrepancy,
  VisualValidationReport,
  RevisionRequest,
} from "./design-engineer/design-engineer-contracts";

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

// ── Reuse Identity ───────────────────────────────────────────────
export {
  reuseIdentitySchema,
  readReuseIdentity,
  withReuseIdentity,
  REUSE_SCHEMA_VERSION,
  REUSE_IDENTITY_METADATA_KEY,
} from "./reuse-identity";

export type { ReuseIdentity } from "./reuse-identity";

// ── Content Hashing ──────────────────────────────────────────────
export { hashContent } from "./content-hash";

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
  proposalAttemptDiagnosticSchema,
  boundedAttemptDiagnostics,
  modelCandidateFailureSchema,
  boundedModelCandidates,
} from "./execution-contract";

export type {
  ExecutionRequest,
  ExecutionRequestOptions,
  ExecutionResult,
  ExecutionErrorDetail,
  ProposalAttemptDiagnostic,
  ModelCandidateFailure,
  ExecutionContract,
  ExecutionRuntimeOptions,
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
  policyRuleTargetSchema,
  policyRuleSchema,
  policyRuleTypeSchema,
  policyViolationTypeSchema,
  executionPolicySchema,
  policyViolationSchema,
  policyEvaluationResultSchema,
  policyContextSchema,
} from "./execution-policy";

export type {
  PolicyRuleTarget,
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
  isApprovalExpired,
  DEFAULT_APPROVAL_EXPIRATION_MS,
} from "./approval";

export type {
  ApprovalStatus,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalManager,
} from "./approval";

// ── Approval Mode ──────────────────────────────────────────────
export {
  approvalModeSchema,
  approvalAuthorizationSchema,
  approvalAuthorizationFromInput,
  stripApprovalModeInput,
  APPROVAL_AUTHORIZATION_METADATA_KEY,
} from "./approval-mode";

export type {
  ApprovalMode,
  ApprovalAuthorization,
} from "./approval-mode";

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

// ── Canonical UI Blueprint (Agent Architecture V2) ───────────────
export {
  UI_BLUEPRINT_SCHEMA_VERSION,
  UI_SEMANTIC_PATCH_SCHEMA_VERSION,
  UI_BLUEPRINT_ARTIFACT_IDS,
  UI_BLUEPRINT_ARTIFACT_TYPES,
  BLUEPRINT_FACT_FIELD_NAMES,
  blueprintBoundSchema,
  blueprintTypographySchema,
  blueprintLayoutSchema,
  blueprintStyleSchema,
  blueprintElementFactsSchema,
  blueprintElementRoleSchema,
  blueprintInteractionKindSchema,
  blueprintEvidenceBasisSchema,
  blueprintImportanceSchema,
  blueprintSemanticsSchema,
  blueprintElementSchema,
  blueprintComponentPropertySchema,
  blueprintComponentInstanceSchema,
  blueprintComponentSchema,
  blueprintFoundationValueSchema,
  blueprintFoundationsSchema,
  blueprintAssetSchema,
  blueprintInteractionSchema,
  blueprintSemanticRegionSchema,
  blueprintRelationshipKindSchema,
  blueprintRelationshipSchema,
  blueprintUncertaintySchema,
  blueprintScreenSchema,
  blueprintProvenanceSchema,
  blueprintEnrichmentStatusSchema,
  blueprintEnrichmentSchema,
  uiBlueprintSchema,
  uiSemanticElementAnnotationSchema,
  uiSemanticComponentAnnotationSchema,
  uiSemanticRegionAnnotationSchema,
  uiSemanticRelationshipSchema,
  uiSemanticPatchSchema,
} from "./ui-blueprint";

export type {
  BlueprintBound,
  BlueprintTypography,
  BlueprintLayout,
  BlueprintStyle,
  BlueprintElementFacts,
  BlueprintElementRole,
  BlueprintInteractionKind,
  BlueprintEvidenceBasis,
  BlueprintSemantics,
  BlueprintElement,
  BlueprintComponent,
  BlueprintFoundations,
  BlueprintSemanticRegion,
  BlueprintRelationship,
  BlueprintUncertainty,
  BlueprintScreen,
  BlueprintProvenance,
  BlueprintEnrichment,
  BlueprintEnrichmentStatus,
  UIBlueprint,
  UISemanticPatch,
} from "./ui-blueprint";

// ── Implementation Map (Agent Architecture V2, phase V2-3) ───────
export * from "./implementation-map";
