import { ExecutionService, CapabilityRegistry } from "@designflow/core";
import type { WorkflowResolver } from "@designflow/core";
import { LocalExecutionRepository } from "@designflow/state";
import { LocalArtifactStore } from "@designflow/artifacts";
import type { CliContext } from "./types";
import { CliLogger } from "./logger";
import type { ExecutionEventPublisher } from "@designflow/sdk";

export interface CliContextConfig {
  workflowResolver: WorkflowResolver;
  capabilityRegistry: CapabilityRegistry;
  eventPublisher: ExecutionEventPublisher;
}

export function createCliContext(config: CliContextConfig): CliContext {
  const { workflowResolver, capabilityRegistry, eventPublisher } = config;
  const logger = new CliLogger();
  const executionRepository = new LocalExecutionRepository();
  const artifactStore = new LocalArtifactStore();

  eventPublisher.subscribe((event) => {
    const timestamp = new Date(event.timestamp).toISOString();
    const payload = event.payload ? ` ${JSON.stringify(event.payload)}` : "";

    switch (event.type) {
      case "execution.started":
        logger.info(`[${timestamp}] Workflow started: ${event.executionId}${payload}`);
        break;
      case "execution.planning":
        logger.info(`[${timestamp}] Planning phase${payload}`);
        break;
      case "execution.executing":
        logger.info(`[${timestamp}] Executing workflow${payload}`);
        break;
      case "execution.validating":
        logger.info(`[${timestamp}] Validating results${payload}`);
        break;
      case "execution.applying":
        logger.info(`[${timestamp}] Applying changes${payload}`);
        break;
      case "execution.completed":
        logger.info(`[${timestamp}] Workflow completed: ${event.executionId}${payload}`);
        break;
      case "execution.failed":
        logger.error(`[${timestamp}] Workflow failed: ${event.executionId}${payload}`);
        break;
      case "execution.cancelled":
        logger.warn(`[${timestamp}] Workflow cancelled: ${event.executionId}${payload}`);
        break;
      case "capability.started":
        logger.debug(`[${timestamp}] Capability started${payload}`);
        break;
      case "capability.completed":
        logger.debug(`[${timestamp}] Capability completed${payload}`);
        break;
      case "capability.failed":
        logger.error(`[${timestamp}] Capability failed${payload}`);
        break;
    }
  });

  const executionService = new ExecutionService({
    workflowResolver,
    capabilityRegistry,
    logger,
    executionRepository,
    artifactStore,
    eventPublisher,
  });

  return {
    logger,
    executionRepository,
    artifactStore,
    executionService,
    eventPublisher,
  };
}
