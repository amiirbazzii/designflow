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

// ── Repository ─────────────────────────────────────────────────────
export { InMemoryExecutionRepository } from "./repository";

// ── Events ─────────────────────────────────────────────────────────
export { InMemoryEventPublisher, ExecutionEventRepositorySubscriber } from "./events";

// ── Artifacts ──────────────────────────────────────────────────────
export { InMemoryArtifactStore, isArtifactRegistry } from "./artifacts";
export type { InMemoryArtifactStoreOptions } from "./artifacts";

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
export { InMemoryApprovalManager, LocalApprovalManager, ApprovalStateTransitionError, ApprovalNotFoundError } from "./approval";

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
  ArtifactNotFoundError,
  ArtifactConflictError,
  ArtifactCycleError,
} from "./errors";