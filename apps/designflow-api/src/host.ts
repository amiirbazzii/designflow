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
import { WorkflowRunner } from "@designflow/product";
import {
  SqliteApprovalManager,
  SqliteArtifactStore,
  SqliteExecutionEventStore,
  SqliteExecutionRepository,
  openDatabase,
} from "@designflow/storage-sqlite";
import { readChangedArtifacts } from "@designflow/sdk";
import type {
  CapabilityReuseResolver,
  Logger,
  WorkflowPackage,
} from "@designflow/sdk";
import {
  designToCodeApprovalPolicy,
  designToCodeWorkflowPackage,
} from "@designflow/workflow-design-to-code";

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
  /** Every execution across all workflows, newest first. */
  listAllExecutions(limit?: number): Promise<readonly { executionId: string; workflowId: string }[]>;
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

  for (const workflowPackage of [designToCodeWorkflowPackage]) {
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
    eventSource: eventStore,
    artifactRegistry: artifactStore,
    approvalManager: approvals,
    resolveWorkflowName: (id) => workflows.get(id)?.name,
    resolveWorkflowStepCount: (id) =>
      workflows.get(id)?.definition.nodes.length,
  });

  return {
    runner,
    workflows,
    async listAllExecutions(limit) {
      const records = await repository.listAll(limit);
      return records.map((record) => ({
        executionId: record.executionId,
        workflowId: record.workflowId,
      }));
    },
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
