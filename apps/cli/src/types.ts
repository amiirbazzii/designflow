import type { ExecutionContext } from "@designflow/sdk";
import type { CapabilityRegistry, ExecutionEngine } from "@designflow/core";
import type { LocalStateStore } from "@designflow/state";
import type { LocalArtifactStore } from "@designflow/artifacts";
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
  phase: string;
  timestamp: number;
  status: string;
}

export interface ResumeResult {
  workflowId: string;
  runId: string;
  status: string;
}
