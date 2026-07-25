import type { ExecutionContext } from "@designflow/sdk";
import { CapabilityRegistry, ExecutionEngine } from "@designflow/core";
import { LocalStateStore } from "@designflow/state";
import { LocalArtifactStore } from "@designflow/artifacts";
import type { CliContext } from "./types";
import { CliLogger } from "./logger";

export function createExecutionContext(
  workflowId: string,
  stateRef: string,
): ExecutionContext {
  const abortController = new AbortController();

  return {
    runId: crypto.randomUUID(),
    workflowId,
    stateRef,
    artifacts: [],
    metadata: {},
    signal: abortController.signal,
  };
}

export function createCliContext(workflowName: string): CliContext {
  const logger = new CliLogger();
  const registry = new CapabilityRegistry();
  const stateStore = new LocalStateStore();
  const artifactStore = new LocalArtifactStore();
  const engine = new ExecutionEngine(registry, logger, artifactStore);
  const executionContext = createExecutionContext(workflowName, "initial");

  return {
    logger,
    registry,
    stateStore,
    artifactStore,
    engine,
    executionContext,
  };
}
