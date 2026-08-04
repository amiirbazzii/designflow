// packages/core/src/index.ts
export const CORE_VERSION = "0.1.0";

// ── Runtime ─────────────────────────────────────────────────────────
export { CapabilityRunner, CapabilityExecutionError } from "./runtime";
export type { CapabilityRunnerOptions } from "./runtime";

// ── DAG Resolver ─────────────────────────────────────────────
export { DagResolver } from "./dag";

// ── Registry ───────────────────────────────────────────────────────
export { CapabilityRegistry, CapabilityRegistryError } from "./registry";

// ── Compiler ─────────────────────────────────────────────
export { WorkflowCompiler } from "./compiler";
export type { CompilationResult } from "./compiler";

// ── Engine ─────────────────────────────────────────────────────────
export { ExecutionEngine } from "./engine";
export type { ExecutionEngineConfig } from "./engine";

// ── Repository ─────────────────────────────────────────────────────
export { InMemoryExecutionRepository } from "./repository";

// ── Events ─────────────────────────────────────────────────────────
export { InMemoryEventPublisher, ExecutionEventRepositorySubscriber } from "./events";

// ── Artifacts ──────────────────────────────────────────────────────
export {
  InMemoryArtifactStore,
  isArtifactRegistry,
  ArtifactIntelligenceService,
} from "./artifacts";
export type {
  InMemoryArtifactStoreOptions,
  ArtifactIntelligenceServiceOptions,
} from "./artifacts";

// ── Reuse Resolver ───────────────────────────────────────────────
export { createArtifactFingerprintReuseResolver } from "./reuse-resolver";
export type { ArtifactFingerprintReuseResolverOptions } from "./reuse-resolver";

// ── Reconciliation ─────────────────────────────────────────────────
export { ArtifactSetReconciler } from "./reconciliation";
export type {
  ArtifactSetReconcilerOptions,
  ReconciliationConflict,
  ReconciliationConflictKind,
  VersionedArtifact,
} from "./reconciliation";

// ── Materialization ────────────────────────────────────────────────
export { RegistryArtifactMaterializer } from "./materialization";
export type {
  RegistryArtifactMaterializerOptions,
  MaterializationIssue,
  MaterializationIssueKind,
} from "./materialization";

// ── Planning ───────────────────────────────────────────────────────
export {
  IncrementalExecutionPlannerService,
  buildWorkflowGraph,
  buildDependentIndex,
  analyzeNodeImpact,
} from "./planning";
export type {
  IncrementalExecutionPlannerOptions,
  WorkflowDefinitionResolver,
} from "./planning";

// ── Policy ─────────────────────────────────────────────────────────
export { InMemoryPolicyEvaluator } from "./policy";

// ── Service ────────────────────────────────────────────────────────
export { ExecutionService } from "./service";
export type { WorkflowResolver, ExecutionServiceConfig } from "./service";
export { WorkflowNotFoundError, InvalidRequestError } from "./service";

// ── Composition ────────────────────────────────────────────────────
export {
  WorkflowCompositionExecutor,
  ExecutionServiceWorkflowResolver,
} from "./composition";
export type {
  WorkflowCompositionRequest,
  WorkflowCompositionOutcome,
} from "./composition";

// ── Approval ───────────────────────────────────────────────────────
export {
  InMemoryApprovalManager,
  LocalApprovalManager,
  ApprovalStateTransitionError,
  ApprovalNotFoundError,
  ApprovalExpiredError,
} from "./approval";

// ── Lifecycle ──────────────────────────────────────────────────────
export type {
  LifecycleStage,
  LifecycleContext,
  PlanResult,
  ExecuteResult,
  ApplyResult,
} from "./lifecycle";

// ── Types ──────────────────────────────────────────────────────────
export type {
  CompiledNode,
  CompiledCapabilityNode,
  CompiledWorkflowNode,
  CompiledWorkflow,
  ExecutionStep,
  ExecutionStepBase,
  CapabilityExecutionStep,
  WorkflowExecutionStep,
  ExecutionLayer,
  ExecutionPlan,
  ExecutionResult,
  PendingChildApproval,
  PendingNodeApproval,
  PendingApproval,
  ValidationResult,
  ValidationIssue,
} from "./types";

// ── Errors ─────────────────────────────────────────────────────────
export {
  WorkflowCompilationError,
  CapabilityNotFoundError,
  ExecutionError,
  ExecutionRepositoryError,
  ExecutionEventError,
  PolicyViolationError,
  ApprovalError,
  WorkflowCompositionError,
  WorkflowCompositionCycleError,
  WorkflowResolverNotConfiguredError,
  ExecutionPlanningError,
  ArtifactMaterializationError,
  ArtifactReconciliationError,
  ArtifactNotFoundError,
  ArtifactVersionNotFoundError,
  ArtifactConflictError,
  ArtifactCycleError,
} from "./errors";
