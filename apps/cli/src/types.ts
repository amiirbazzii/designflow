import type { ExecutionContext } from "@designflow/sdk";
import type { CapabilityRegistry, ExecutionEngine } from "@designflow/core";
import type { LocalStateStore } from "@designflow/state";
import type { LocalArtifactStore } from "@designflow/artifacts";
import type { CheckpointRecord } from "@designflow/sdk";
import type { CliLogger } from "./logger";

export interface CliConfig {
  workflows?: {
    directory?: string;
  };
}

export interface CliContext {
  logger: CliLogger;
  registry: CapabilityRegistry;
  stateStore: LocalStateStore;
  artifactStore: LocalArtifactStore;
  engine: ExecutionEngine;
  executionContext: ExecutionContext;
}

export interface RunResult {
  workflowId: string;
  runId: string;
  status: string;
}

export interface StatusResult {
  workflowId: string;
  checkpoints: readonly Pick<CheckpointRecord, "checkpointId" | "timestamp" | "metadata">[];
}

export interface ResumeResult {
  workflowId: string;
  checkpoint: unknown;
  timestamp: number | null;
}
