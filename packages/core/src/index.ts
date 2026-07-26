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

// ── Policy ─────────────────────────────────────────────────────────
export { InMemoryPolicyEvaluator } from "./policy";

// ── Service ────────────────────────────────────────────────────────
export { ExecutionService } from "./service";
export type { WorkflowResolver, ExecutionServiceConfig } from "./service";
export { WorkflowNotFoundError, InvalidRequestError } from "./service";

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
  CompiledWorkflow,
  ExecutionStep,
  ExecutionLayer,
  ExecutionPlan,
  ExecutionResult,
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
} from "./errors";