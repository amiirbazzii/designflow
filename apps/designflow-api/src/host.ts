// apps/designflow-api/src/host.ts
import {
  ArtifactIntelligenceService,
  ArtifactSetReconciler,
  CapabilityRegistry,
  ExecutionService,
  InMemoryEventPublisher,
  InMemoryPolicyEvaluator,
  IncrementalExecutionPlannerService,
  RegistryArtifactMaterializer,
} from "@designflow/core";
import {
  WorkflowRunner,
  WorkerTaskRouter,
  AgentSessionService,
  ProductExecutionService,
  WorkerCatalogService,
  WorkerResultService,
} from "@designflow/product";
import {
  SqliteApprovalManager,
  SqliteArtifactStore,
  SqliteExecutionEventStore,
  SqliteExecutionRepository,
  SqliteSessionStore,
  openDatabase,
} from "@designflow/storage-sqlite";
import {
  readChangedArtifacts,
  type CapabilityReuseResolver,
  type Logger,
  type WorkflowPackage,
} from "@designflow/sdk";
import { AgentRuntime, assertWorkerAgentAlignment, createAgentRegistry } from "@designflow/agents";
import { ToolRuntime, createToolRegistry } from "@designflow/tools";
import { createWorkerRegistry } from "@designflow/workers";
import {
  designToCodeApprovalPolicy,
  designToCodeFigmaSpecificationWorkflowPackage,
  designToCodeWorkflowPackage,
  evaluateDesignEngineerCriterion,
} from "@designflow/workflow-design-to-code";
import {
  qaReviewApprovalPolicy,
  qaReviewWorkflowPackage,
  evaluateQaReviewerCriterion,
} from "@designflow/workflow-qa-review";
import {
  researchAnalysisApprovalPolicy,
  researchAnalysisWorkflowPackage,
  evaluateResearchAnalystCriterion,
} from "@designflow/workflow-research-analysis";
import {
  productBriefApprovalPolicy,
  productBriefWorkflowPackage,
  evaluateProductManagerCriterion,
} from "@designflow/workflow-product-brief";

/**
 * The API's composition root.
 *
 * The only place in the MVP that names a concrete implementation. Everything
 * above it — the routes, and the web client beyond them — speaks
 * `@designflow/product`.
 *
 * Every collaborator here is SQLite-backed, so a run survives a restart: the
 * execution record, its approvals, its raw event stream and its artifacts all
 * outlive the process that produced them. Only the event *publisher* stays in
 * memory, because it is a dispatcher rather than a store — its output is what
 * the event store persists.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface ApiHost {
  readonly runner: WorkflowRunner;
  readonly workflows: ReadonlyMap<string, WorkflowPackage>;
  /** The Worker Task Boundary — Stage 41's product surface, not raw workflow ids. */
  readonly workerCatalog: WorkerCatalogService;
  readonly workerResults: WorkerResultService;
  readonly sessions: AgentSessionService;
  close(): void;
}

export interface ApiHostOptions {
  /** SQLite file. `:memory:` gives an ephemeral host for tests. */
  readonly databasePath?: string;
  readonly requireApproval?: boolean;
  readonly incremental?: boolean;
}

export function createApiHost(options?: ApiHostOptions): ApiHost {
  const requireApproval = options?.requireApproval !== false;
  const incremental = options?.incremental !== false;

  const db = openDatabase(options?.databasePath ?? "designflow.sqlite");

  const eventPublisher = new InMemoryEventPublisher(silentLogger);
  const eventStore = new SqliteExecutionEventStore(db);
  eventStore.subscribeTo(eventPublisher);

  const artifactStore = new SqliteArtifactStore(db, { eventPublisher });
  const repository = new SqliteExecutionRepository(db);
  const approvals = new SqliteApprovalManager(db);

  const capabilityRegistry = new CapabilityRegistry();
  const workflows = new Map<string, WorkflowPackage>();

  for (const workflowPackage of [
    designToCodeWorkflowPackage,
    // The read-only specification journey is the design-engineer worker's
    // default workflow since the V2 flagship migration.
    designToCodeFigmaSpecificationWorkflowPackage,
    qaReviewWorkflowPackage,
    researchAnalysisWorkflowPackage,
    productBriefWorkflowPackage,
  ]) {
    workflowPackage.load(capabilityRegistry);
    workflows.set(workflowPackage.id, workflowPackage);
  }

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
          // Combined the same way the CLI's composition root combines them —
          // each workflow's rule `target` is that workflow's own step id, and
          // step ids are unique across the four built-in workflows.
          policy: {
            id: "combined-approval",
            name: "Combined approval gate",
            rules: [
              ...designToCodeApprovalPolicy.rules,
              ...qaReviewApprovalPolicy.rules,
              ...researchAnalysisApprovalPolicy.rules,
              ...productBriefApprovalPolicy.rules,
            ],
          },
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
    eventSource: eventStore,
    artifactRegistry: artifactStore,
    approvalManager: approvals,
    resolveWorkflowName: (id) => workflows.get(id)?.name,
    resolveWorkflowStepCount: (id) =>
      workflows.get(id)?.definition.nodes.length,
  });

  // The Worker Task Boundary (Stage 41): the API speaks Workers, not raw
  // workflow ids, from here down. Every catalog agent runs in its
  // deterministic (offline) strategy by default — this host names no
  // OpenRouter credential, matching the "web/demo may use deterministic
  // mode... where model credentials are unavailable" allowance, so nothing
  // here depends on a live provider being reachable.
  const workers = createWorkerRegistry();
  const toolRuntime = new ToolRuntime({ registry: createToolRegistry(), logger: silentLogger });
  const agentRegistry = createAgentRegistry();

  for (const worker of workers.listWorkers()) {
    if (worker.agentId === undefined) continue;
    assertWorkerAgentAlignment(worker, agentRegistry.require(worker.agentId).manifest);
  }

  const agentRuntime = new AgentRuntime({
    registry: agentRegistry,
    availableWorkflows: [...workflows.keys()],
    tools: toolRuntime,
    logger: silentLogger,
  });

  const taskRouter = new WorkerTaskRouter({ workers, agents: agentRuntime });

  const sessions = new AgentSessionService({
    store: new SqliteSessionStore(db),
    workers,
    router: taskRouter,
    runner,
  });

  const execution = new ProductExecutionService({
    executionRepository: repository,
    eventSource: eventStore,
    artifactRegistry: artifactStore,
    resolveWorkflowName: (id) => workflows.get(id)?.name,
  });

  const workerResults = new WorkerResultService({
    execution,
    workers,
    listAllOverviews: (limit) => execution.listAllOverviews(limit),
    getArtifactPayload: async (artifactId) => (await artifactStore.get(artifactId))?.data,
    evaluators: {
      "design-engineer": evaluateDesignEngineerCriterion,
      "qa-reviewer": evaluateQaReviewerCriterion,
      "research-analyst": evaluateResearchAnalystCriterion,
      "product-manager": evaluateProductManagerCriterion,
    },
  });

  return {
    runner,
    workflows,
    workerCatalog: new WorkerCatalogService(workers),
    workerResults,
    sessions,
    close: () => db.close(),
  };
}

/**
 * The host's caching policy: reuse a node's prior output when the change set
 * does not reach it.
 *
 * A product decision, not an engine one — the engine poses the question and
 * honours the answer. Impact comes from `ArtifactIntelligenceService`, so this
 * and the planner's skip decision derive from the same lineage graph.
 */
function createReuseResolver(
  workflows: ReadonlyMap<string, WorkflowPackage>,
  artifactStore: SqliteArtifactStore,
  repository: SqliteExecutionRepository,
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
