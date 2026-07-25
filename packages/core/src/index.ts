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
} from "./errors";
