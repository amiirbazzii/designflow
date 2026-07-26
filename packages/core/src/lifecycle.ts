import type { ArtifactRef, ExecutionContext } from "@designflow/sdk";
import type { CompiledWorkflow, PendingChildApproval } from "./types";

export type LifecycleStage = "plan" | "execute" | "validate" | "apply";

export interface LifecycleContext {
  readonly execution: ExecutionContext;
  readonly workflow: CompiledWorkflow;
  readonly stage: LifecycleStage;
}

export interface PlanResult {
  readonly plannedSteps: readonly string[];
  readonly artifacts: readonly ArtifactRef[];
}

export interface ExecuteResult {
  readonly executedSteps: readonly string[];
  readonly candidateArtifacts: readonly ArtifactRef[];
  readonly failedSteps: readonly string[];
  readonly failedErrors: Readonly<Record<string, unknown>>;
  /** Nodes whose child execution is awaiting an approval decision. */
  readonly pendingApprovals: readonly PendingChildApproval[];
  /** Nodes not run because an upstream node is pending approval. */
  readonly blockedSteps: readonly string[];
}

export interface ApplyResult {
  readonly appliedArtifacts: readonly ArtifactRef[];
  readonly committed: boolean;
}
