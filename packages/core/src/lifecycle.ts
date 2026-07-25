import type { ArtifactRef, ExecutionContext } from "@designflow/sdk";
import type { CompiledWorkflow } from "./types";

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
}

export interface ApplyResult {
  readonly appliedArtifacts: readonly ArtifactRef[];
  readonly committed: boolean;
}
