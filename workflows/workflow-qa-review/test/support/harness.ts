// workflows/workflow-qa-review/test/support/harness.ts
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
} from "@designflow/product";
import {
  readChangedArtifacts,
  withChangedArtifacts,
  type CapabilityReuseResolver,
  type ExecutionEvent,
  type ExecutionPolicy,
  type Logger,
  type WorkflowPackage,
} from "@designflow/sdk";
import { qaReviewWorkflowPackage } from "../../src/manifest";

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

export interface QaReviewHost {
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
}): QaReviewHost {
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
  qaReviewWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [qaReviewWorkflowPackage.id, qaReviewWorkflowPackage],
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
          reuseResolver: createReuseResolver(workflows, artifactStore, repository),
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

/**
 * The host's caching policy: reuse a node's prior output when the change set
 * does not reach it.
 *
 * This is the piece that makes incremental execution complete. The planner
 * decides a node needs no computation; without a resolver to supply that
 * node's artifacts, its dependents would run without them. Deliberately a
 * *host* concern — the engine poses the question and honours the answer, and
 * what counts as a cache hit is a product decision.
 *
 * Impact is answered by `ArtifactIntelligenceService`, so the reuse decision
 * and the planner's skip decision are derived from the same lineage graph and
 * cannot disagree.
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

      // Everything the change set invalidates, directly or downstream.
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
        // Nothing to reuse on a first run; the node runs normally.
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

/** A review target with three implementation items, one of them incomplete. */
export const SAMPLE_TARGET = {
  id: "checkout-flow",
  description: "Checkout flow implementation",
  scope: ["ui", "accessibility"],
  severityThreshold: "minor" as const,
  items: [
    {
      path: "src/components/CheckoutButton.tsx",
      kind: "component",
      content: '<div onClick={submit}>#fff Pay now</div>',
    },
    {
      path: "src/components/CheckoutSummary.tsx",
      kind: "component",
      content: "<section>Summary</section>",
    },
    {
      path: "src/components/CheckoutForm.tsx",
      kind: "component",
    },
  ],
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
