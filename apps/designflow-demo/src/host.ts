// apps/designflow-demo/src/host.ts
import {
  ArtifactIntelligenceService,
  ArtifactSetReconciler,
  CapabilityRegistry,
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
  buildProgress,
} from "@designflow/product";
import type { ExecutionProgress } from "@designflow/product";
import { readChangedArtifacts } from "@designflow/sdk";
import type {
  CapabilityReuseResolver,
  ExecutionEvent,
  Logger,
  WorkflowPackage,
} from "@designflow/sdk";
import { designToCodeApprovalPolicy, designToCodeWorkflowPackage } from "@designflow/workflow-design-to-code";

/**
 * The demo's composition root.
 *
 * This is the **only** file in the application that imports `@designflow/core`.
 * Every screen and the journey itself speak `@designflow/product` alone — a
 * test in this package enforces that, so the boundary cannot rot.
 *
 * Wiring concrete implementations is unavoidable somewhere: `WorkflowRunner`
 * takes an `ExecutionContract`, and the only thing that satisfies it is the
 * engine. Confining that to one file is what keeps "the demo consumes
 * DesignFlow" true of the application rather than merely aspirational.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Notified whenever a run's progress changes, so a view can redraw. */
export type ProgressListener = (
  executionId: string,
  progress: ExecutionProgress,
) => void;

export interface DemoHost {
  readonly runner: WorkflowRunner;
  /** Subscribes to live progress while an execution is in flight. */
  onProgress(listener: ProgressListener): void;
}

export interface DemoHostOptions {
  /** Gate `generate-code` behind a human decision. On by default. */
  readonly requireApproval?: boolean;
  /** Reuse unchanged artifacts across runs. On by default. */
  readonly incremental?: boolean;
}

export function createDemoHost(options?: DemoHostOptions): DemoHost {
  const requireApproval = options?.requireApproval !== false;
  const incremental = options?.incremental !== false;

  const eventPublisher = new InMemoryEventPublisher(silentLogger);
  const collector = new InMemoryExecutionEventCollector();
  collector.subscribeTo(eventPublisher);

  const artifactStore = new InMemoryArtifactStore({ eventPublisher });
  const repository = new InMemoryExecutionRepository();
  const approvals = new InMemoryApprovalManager();

  const capabilityRegistry = new CapabilityRegistry();
  const workflows = new Map<string, WorkflowPackage>();

  for (const workflowPackage of [designToCodeWorkflowPackage]) {
    workflowPackage.load(capabilityRegistry);
    workflows.set(workflowPackage.id, workflowPackage);
  }

  // Live progress. Events are published synchronously as the engine works, so
  // a listener attached here sees each step as it happens — which is what lets
  // the progress screen redraw during an awaited `start()`.
  const seen = new Map<string, ExecutionEvent[]>();
  const listeners: ProgressListener[] = [];

  eventPublisher.subscribe((event) => {
    const events = seen.get(event.executionId) ?? [];
    events.push(event);
    seen.set(event.executionId, events);

    if (!event.type.startsWith("capability.")) return;

    const progress = buildProgress(
      events,
      workflows.get(recordedWorkflowId(events))?.definition.nodes.length,
    );

    for (const listener of listeners) {
      listener(event.executionId, progress);
    }
  });

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    ...(requireApproval
      ? {
          policy: designToCodeApprovalPolicy,
          policyEvaluator: new InMemoryPolicyEvaluator(),
        }
      : {}),
    ...(incremental
      ? {
          incrementalPlanner: new IncrementalExecutionPlannerService({
            resolveWorkflow: (id) => workflows.get(id)?.definition,
            executionRepository: repository,
          }),
          reuseResolver: createReuseResolver(
            workflows,
            artifactStore,
            repository,
          ),
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
    onProgress(listener) {
      listeners.push(listener);
    },
  };
}

/** The workflow an execution belongs to, as named by its first event. */
function recordedWorkflowId(events: readonly ExecutionEvent[]): string {
  for (const event of events) {
    const workflowId = event.payload?.workflowId;
    if (typeof workflowId === "string" && workflowId.length > 0) {
      return workflowId;
    }
  }

  return "";
}

/**
 * The demo's caching policy: reuse a node's prior output when the change set
 * does not reach it.
 *
 * Deliberately the *host's* decision, not the engine's. What counts as a cache
 * hit is a product question, and the engine only poses it. Impact is answered
 * by `ArtifactIntelligenceService` so this and the planner's skip decision
 * derive from the same lineage graph and cannot disagree.
 */
function createReuseResolver(
  workflows: ReadonlyMap<string, WorkflowPackage>,
  artifactStore: InMemoryArtifactStore,
  repository: InMemoryExecutionRepository,
): CapabilityReuseResolver {
  const intelligence = new ArtifactIntelligenceService({
    registry: artifactStore,
  });

  const declined = { reuse: false as const, artifacts: [] };

  return {
    async resolve(request) {
      const definition = workflows.get(request.workflowId)?.definition;
      const node = definition?.nodes.find(
        (candidate) =>
          "capabilityId" in candidate &&
          candidate.capabilityId === request.capabilityId,
      );

      const produces = node?.produces ?? [];
      if (produces.length === 0) return declined;

      const record = await repository.get(request.executionId);
      const changed = readChangedArtifacts(record?.metadata);

      const affected = new Set<string>(changed);
      for (const artifactId of changed) {
        if ((await artifactStore.getArtifact(artifactId)) === null) continue;

        const impact = await intelligence.analyzeImpact(artifactId);
        for (const id of impact.affectedArtifacts) affected.add(id);
      }

      if (produces.some((id) => affected.has(id))) return declined;

      const artifacts = [];
      for (const artifactId of produces) {
        const artifact = await artifactStore.getArtifact(artifactId);
        if (artifact === null) return declined;

        artifacts.push({
          id: artifact.id,
          type: artifact.type,
          metadata: artifact.metadata,
        });
      }

      return { reuse: true, artifacts, reason: "unaffected by the change set" };
    },
  };
}
