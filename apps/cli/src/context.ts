import { ExecutionService, CapabilityRegistry } from "@designflow/core";
import type { WorkflowResolver } from "@designflow/core";
import { LocalStateStore } from "@designflow/state";
import { LocalArtifactStore } from "@designflow/artifacts";
import type { CliContext } from "./types";
import { CliLogger } from "./logger";

export function createCliContext(
  workflowResolver: WorkflowResolver,
  capabilityRegistry: CapabilityRegistry,
): CliContext {
  const logger = new CliLogger();
  const stateStore = new LocalStateStore();
  const artifactStore = new LocalArtifactStore();

  const executionService = new ExecutionService({
    workflowResolver,
    capabilityRegistry,
    logger,
    stateStore,
    artifactStore,
  });

  return {
    logger,
    stateStore,
    artifactStore,
    executionService,
  };
}
