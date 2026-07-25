import type { ExecutionContract, StateStore, ArtifactStore } from "@designflow/sdk";
import type { CliLogger } from "./logger";

export interface CliConfig {
  workflows?: {
    directory?: string;
  };
}

export interface CliContext {
  logger: CliLogger;
  stateStore: StateStore;
  artifactStore: ArtifactStore;
  executionService: ExecutionContract;
}

export interface RunResult {
  workflowId: string;
  runId: string;
  status: string;
}

export interface StatusResult {
  workflowId: string;
  phase: string;
  timestamp: number;
  status: string;
}

export interface ResumeResult {
  workflowId: string;
  runId: string;
  status: string;
}
