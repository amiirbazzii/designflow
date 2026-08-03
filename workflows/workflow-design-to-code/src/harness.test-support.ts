// workflows/workflow-design-to-code/src/harness.test-support.ts
import {
  ArtifactSetReconciler,
  CapabilityRegistry,
  createArtifactFingerprintReuseResolver,
  ExecutionService,
  InMemoryApprovalManager,
  InMemoryArtifactStore,
  InMemoryEventPublisher,
  InMemoryExecutionRepository,
  InMemoryPolicyEvaluator,
  IncrementalExecutionPlannerService,
  RegistryArtifactMaterializer,
} from "@designflow/core";
import {
  InMemoryExecutionEventCollector,
  WorkflowRunner,
} from "@designflow/product";
import {
  withChangedArtifacts,
  type ExecutionEvent,
  type ExecutionPolicy,
  type Logger,
  type WorkflowPackage,
} from "@designflow/sdk";
import { designToCodeWorkflowPackage } from "./manifest";

/**
 * A fully wired DesignFlow host, for the workflow's integration tests.
 *
 * This file is the only place in the package that touches `@designflow/core`,
 * and it is excluded from the build (`tsconfig` omits test sources), so the
 * published package still depends on `@designflow/sdk` alone. Proving the
 * workflow runs means running it, and running it needs an engine.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface DesignToCodeHost {
  readonly runner: WorkflowRunner;
  readonly service: ExecutionService;
  readonly artifactStore: InMemoryArtifactStore;
  readonly repository: InMemoryExecutionRepository;
  readonly approvals: InMemoryApprovalManager;
  readonly collector: InMemoryExecutionEventCollector;
  readonly events: ExecutionEvent[];
}

export function createHost(options?: {
  readonly policy?: ExecutionPolicy;
  readonly incremental?: boolean;
}): DesignToCodeHost {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher(silentLogger);
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const collector = new InMemoryExecutionEventCollector();
  collector.subscribeTo(eventPublisher);

  const artifactStore = new InMemoryArtifactStore({ eventPublisher });
  const repository = new InMemoryExecutionRepository();
  const approvals = new InMemoryApprovalManager();

  const capabilityRegistry = new CapabilityRegistry();
  designToCodeWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [designToCodeWorkflowPackage.id, designToCodeWorkflowPackage],
  ]);

  const incremental = options?.incremental === true;

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    ...(options?.policy !== undefined
      ? {
          policy: options.policy,
          policyEvaluator: new InMemoryPolicyEvaluator(),
        }
      : {}),
    ...(incremental
      ? {
          incrementalPlanner: new IncrementalExecutionPlannerService({
            resolveWorkflow: (id) => workflows.get(id)?.definition,
            executionRepository: repository,
          }),
          reuseResolver: createArtifactFingerprintReuseResolver({
            workflows,
            artifactStore,
            repository,
          }),
          artifactMaterializer: new RegistryArtifactMaterializer({
            registry: artifactStore,
            eventPublisher,
          }),
          executionReconciler: new ArtifactSetReconciler({
            registry: artifactStore,
          }),
        }
      : {}),
  });

  const runner = new WorkflowRunner({
    executionContract: service,
    executionRepository: repository,
    eventSource: collector,
    artifactRegistry: artifactStore,
    approvalManager: approvals,
    resolveWorkflowName: (id) => workflows.get(id)?.name,
    resolveWorkflowStepCount: (id) =>
      workflows.get(id)?.definition.nodes.length,
  });

  return {
    runner,
    service,
    artifactStore,
    repository,
    approvals,
    collector,
    events,
  };
}

/** A design with three frames across two token groups. */
export const SAMPLE_DESIGN = {
  designFile: "homepage.fig",
  framework: "react" as const,
  frames: ["brand/Header", "brand/Footer", "layout/Sidebar"],
};

/** Marks a re-run as incremental, naming what the caller believes changed. */
export function incrementalMetadata(
  previousExecutionId: string,
  changedArtifacts: readonly string[],
): Record<string, unknown> {
  return {
    ...withChangedArtifacts({}, changedArtifacts),
    previousExecutionId,
  };
}
