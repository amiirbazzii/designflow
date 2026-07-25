export const CORE_VERSION = "0.1.0";

// ── Registry ───────────────────────────────────────────────────────
export { CapabilityRegistry } from "./registry";

// ── Compiler ───────────────────────────────────────────────────────
export { WorkflowCompiler } from "./compiler";

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
