import { ExecutionService, CapabilityRegistry } from "@designflow/core";
import type { WorkflowResolver } from "@designflow/core";
import { LocalExecutionRepository } from "@designflow/state";
import { LocalArtifactStore } from "@designflow/artifacts";
import type { CliContext } from "./types";
import { CliLogger } from "./logger";

export function createCliContext(
  workflowResolver: WorkflowResolver,
  capabilityRegistry: CapabilityRegistry,
): CliContext {
  const logger = new CliLogger();
  const executionRepository = new LocalExecutionRepository();
  const artifactStore = new LocalArtifactStore();

  const executionService = new ExecutionService({
    workflowResolver,
    capabilityRegistry,
    logger,
    executionRepository,
    artifactStore,
  });

  return {
    logger,
    executionRepository,
    artifactStore,
    executionService,
  };
}
