// workflows/workflow-research-analysis/test/support/harness.ts
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
import { researchAnalysisWorkflowPackage } from "../../src/manifest";

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

export interface ResearchAnalysisHost {
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
}): ResearchAnalysisHost {
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
  researchAnalysisWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [researchAnalysisWorkflowPackage.id, researchAnalysisWorkflowPackage],
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
 * Deliberately a *host* concern — the engine poses the question and honours
 * the answer, and what counts as a cache hit is a product decision.
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

/**
 * A research question with four supplied sources. `src-1`, `src-2` and
 * `src-3` disagree on the central question (a conflict the comparison step
 * should surface); `src-2` and `src-4` independently agree on a secondary
 * point. Every source carries real content, so all four are valid.
 */
export const SAMPLE_RESEARCH: {
  readonly question: string;
  readonly sources: readonly {
    readonly id: string;
    readonly title: string;
    readonly url: string;
    readonly content: string;
    readonly author: string;
  }[];
} = {
  question: "Does remote work improve engineering productivity?",
  sources: [
    {
      id: "src-1",
      title: "Remote Work Study 2024",
      url: "https://example.org/remote-work-2024",
      content:
        "Remote work improves engineering productivity. Documentation quality has improved this year.",
      author: "J. Alvarez",
    },
    {
      id: "src-2",
      title: "Distributed Teams Survey",
      url: "https://example.org/distributed-teams",
      content:
        "Remote work improves engineering productivity for distributed teams. Meetings run more efficiently with async updates.",
      author: "P. Chen",
    },
    {
      id: "src-3",
      title: "Office Culture Report",
      url: "https://example.org/office-culture",
      content:
        "Remote work does not improve engineering productivity for new teams. Onboarding remotely takes longer than expected.",
      author: "R. Osei",
    },
    {
      id: "src-4",
      title: "Async Collaboration Notes",
      url: "https://example.org/async-notes",
      content:
        "Meetings run more efficiently with async updates for distributed engineering teams. This report was inconclusive on hiring costs.",
      author: "M. Novak",
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
