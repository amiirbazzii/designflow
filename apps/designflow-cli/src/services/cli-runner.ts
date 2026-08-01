// apps/designflow-cli/src/services/cli-runner.ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
  TraceCollector,
  TraceService,
  buildProgress,
} from "@designflow/product";
import type {
  ExecutionProgress,
  WorkerTaskRequest,
  WorkerTaskResult,
} from "@designflow/product";
import {
  AgentRuntime,
  assertWorkerAgentAlignment,
  createAgentRegistry,
} from "@designflow/agents";
import { ToolRuntime, createToolRegistry } from "@designflow/tools";
import {
  FileApprovalManager,
  FileArtifactStore,
  FileExecutionEventStore,
  FileExecutionRepository,
  FileStore,
  FileTraceStore,
} from "@designflow/storage-file";
import { primaryWorkflowOf, readChangedArtifacts } from "@designflow/sdk";
import type {
  CapabilityReuseResolver,
  ExecutionEvent,
  Logger,
  WorkerManifest,
  WorkflowPackage,
} from "@designflow/sdk";
import { createWorkerRegistry } from "@designflow/workers";
import type { InMemoryWorkerRegistry } from "@designflow/workers";
import {
  designToCodeApprovalPolicy,
  designToCodeWorkflowPackage,
} from "@designflow/workflow-design-to-code";
import { resolveDatabasePath } from "./config";
import { initializeHome } from "./home";
import type { HomeState } from "./home";

/**
 * The CLI's composition root — the one allowed exception to the import rule.
 *
 * Nothing else in this package names a concrete implementation: every command
 * and every renderer speaks `@designflow/product`. A test walks the sources
 * and fails if that stops being true.
 *
 * Wiring has to happen somewhere. `WorkflowRunner` takes an
 * `ExecutionContract`, and the only thing satisfying it is the engine.
 * Confining that to this file is what keeps "the CLI consumes DesignFlow" a
 * property of the application rather than a slogan.
 *
 * Storage is a JSON document under `~/.designflow`, which is what makes a CLI
 * usable at all: every invocation is a new process, so history and approvals
 * would vanish between commands if they lived in memory.
 *
 * File-backed rather than SQLite so the published package needs no native
 * module and no runtime but Node. `@designflow/storage-sqlite` remains the
 * right choice for the API tier, where concurrency and volume matter.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface WorkflowInfo {
  readonly workflowId: string;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly string[];
}

/** A worker plus the workflow it resolves to. */
export interface ResolvedWorker {
  readonly worker: WorkerManifest;
  readonly workflowId: string;
  /**
   * False when the worker names a workflow this installation does not have.
   *
   * A worker is metadata, so it can reference a workflow that is not present.
   * That is a configuration problem worth naming precisely rather than letting
   * the engine raise `ERR_WORKFLOW_NOT_FOUND` from under a stack trace.
   */
  readonly workflowInstalled: boolean;
  /** Number of steps the workflow declares, for the progress denominator. */
  readonly steps: number;
}

export type ProgressListener = (progress: ExecutionProgress) => void;

export interface CliContext {
  readonly runner: WorkflowRunner;
  /** The worker catalogue — what a person chooses from. */
  readonly workers: InMemoryWorkerRegistry;
  /**
   * The application directory, and whether this invocation created it.
   *
   * `dispatch` reads `home.firstRun` to decide whether to show onboarding. The
   * directory work already happened by the time a context exists; this only
   * reports what was found or done.
   */
  readonly home: HomeState;
  /** Where this context's runs are stored. Shown by `settings`. */
  readonly databasePath: string;
  /**
   * Resolves a name to something runnable.
   *
   * Accepts a worker id, and falls back to a workflow id so that a workflow
   * with no worker wrapping it stays reachable. Returns null when neither
   * matches.
   */
  resolve(name: string): ResolvedWorker | null;
  /**
   * Turns "this worker, this request" into a decision about what to do.
   *
   * The only way a command starts work. Whether a worker delegated to an agent
   * or mapped straight to a workflow is settled behind this call, so no
   * command learns which workflow was chosen or that agents exist.
   */
  routeTask(request: WorkerTaskRequest): Promise<WorkerTaskResult>;
  /**
   * What happened during past AI decisions.
   *
   * The product read API, never the store. A command that could write traces
   * could make the record say whatever it liked, which is not an audit record —
   * so the one write exposed here is `correlate`, and only because the CLI is
   * the only party that learns which execution a decision produced.
   */
  readonly traces: TraceService;
  /** Installed workflows. Still needed by `resolve`; no longer user-facing. */
  listWorkflows(): readonly WorkflowInfo[];
  /** Redraws while a run is in flight. */
  onProgress(listener: ProgressListener): void;
  close(): void;
}

export interface CliContextOptions {
  /** Overrides the configured database. Tests pass a temporary file. */
  readonly databasePath?: string;
  readonly requireApproval?: boolean;
  /**
   * Overrides the worker catalogue.
   *
   * The built-in catalogue is the default. A host embedding the CLI can supply
   * a curated one, and a test can supply an empty one — which is the only way
   * to exercise "no workers installed" without the shell hardcoding a name it
   * could then check for.
   */
  readonly workers?: InMemoryWorkerRegistry;
}

export function createCliContext(options?: CliContextOptions): CliContext {
  // First: lay out `~/.designflow`. Everything below needs somewhere to write,
  // and a fresh install has nowhere until this runs.
  const home = initializeHome();
  const databasePath = options?.databasePath ?? resolveDatabasePath(home.config);

  mkdirSync(dirname(databasePath), { recursive: true });

  const requireApproval = options?.requireApproval !== false;

  // One document, shared by every adapter, so a single write persists a
  // consistent view rather than four partial ones.
  const store = new FileStore(databasePath);

  const eventPublisher = new InMemoryEventPublisher(silentLogger);
  const eventStore = new FileExecutionEventStore(store);
  eventStore.subscribeTo(eventPublisher);

  const artifactStore = new FileArtifactStore(store, { eventPublisher });
  const repository = new FileExecutionRepository(store);
  const approvals = new FileApprovalManager(store);

  const capabilityRegistry = new CapabilityRegistry();
  const workflows = new Map<string, WorkflowPackage>();
  const workers = options?.workers ?? createWorkerRegistry();

  for (const workflowPackage of [designToCodeWorkflowPackage]) {
    workflowPackage.load(capabilityRegistry);
    workflows.set(workflowPackage.id, workflowPackage);
  }

  // Live progress: events publish while `start` is awaited, so a listener
  // attached up front sees each step as it lands.
  const seen = new Map<string, ExecutionEvent[]>();
  const listeners: ProgressListener[] = [];

  eventPublisher.subscribe((event) => {
    const events = seen.get(event.executionId) ?? [];
    events.push(event);
    seen.set(event.executionId, events);

    if (!event.type.startsWith("capability.")) return;

    const progress = buildProgress(
      events,
      workflows.get(workflowIdOf(events))?.definition.nodes.length,
    );

    for (const listener of listeners) listener(progress);
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
    incrementalPlanner: new IncrementalExecutionPlannerService({
      resolveWorkflow: (id) => workflows.get(id)?.definition,
      executionRepository: repository,
    }),
    reuseResolver: createReuseResolver(workflows, artifactStore, repository),
    artifactMaterializer: new RegistryArtifactMaterializer({
      registry: artifactStore,
      eventPublisher,
    }),
    executionReconciler: new ArtifactSetReconciler({ registry: artifactStore }),
  });

  // Agents decide; they do not execute. The runtime is handed the installed
  // workflow ids and nothing else — no repository, no artifact store, no
  // execution service — so an agent can name a workflow and can do nothing
  // with the name itself.
  const agentRegistry = createAgentRegistry();

  // Tools inform a decision; they never perform work. The runtime is handed a
  // registry and nothing else — no runner, no repository, no artifact store —
  // so a tool can report what it found and can do nothing with the finding.
  //
  // `project-summary` is deliberately absent: it reads a directory, and this
  // host has no directory it is willing to name as safe to inspect. A tool
  // that needs a filesystem grant does not get one by default, and the day
  // this host wants project inspection, the grant appears on this line where
  // it can be reviewed.
  const toolRuntime = new ToolRuntime({
    registry: createToolRegistry(),
    logger: silentLogger,
  });

  // Traces share the same document as executions, so a run and the decision
  // that started it are written in one atomic rename.
  const traceStore = new FileTraceStore(store);
  const traces = new TraceService(traceStore);

  const agentRuntime = new AgentRuntime({
    registry: agentRegistry,
    availableWorkflows: [...workflows.keys()],
    tools: toolRuntime,
    tracer: new TraceCollector(traceStore),
    logger: silentLogger,
  });

  // A worker that advertises work its agent may never choose is a
  // configuration mistake. Caught here, at wiring time, rather than on the
  // first run that happens to hit the offending workflow.
  for (const worker of workers.listWorkers()) {
    if (worker.agentId === undefined) continue;
    assertWorkerAgentAlignment(worker, agentRegistry.require(worker.agentId).manifest);
  }

  const taskRouter = new WorkerTaskRouter({
    workers,
    agents: agentRuntime,
  });

  const runner = new WorkflowRunner({
    executionContract: service,
    executionRepository: repository,
    eventSource: eventStore,
    artifactRegistry: artifactStore,
    approvalManager: approvals,
    resolveWorkflowName: (id) => workflows.get(id)?.name,
    resolveWorkflowStepCount: (id) => workflows.get(id)?.definition.nodes.length,
  });

  /**
   * Worker or workflow id to something runnable.
   *
   * Named rather than inlined on the returned object so `routeTask` can reuse
   * it: both answer the same question about the same name, and two copies of
   * this would let `run <name>` and the decision behind it disagree.
   */
  const resolveName = (name: string): ResolvedWorker | null => {
    const worker = workers.getWorker(name);

    if (worker !== undefined) {
      const workflowId = primaryWorkflowOf(worker);
      const workflow = workflows.get(workflowId);

      return {
        worker,
        workflowId,
        workflowInstalled: workflow !== undefined,
        steps: workflow?.definition.nodes.length ?? 0,
      };
    }

    // A workflow with no worker would otherwise be unreachable from the CLI.
    const workflow = workflows.get(name);
    if (workflow === undefined) return null;

    const owner = workers.findByWorkflow(name);

    return {
      // Synthesised so the caller has one shape to render either way. The
      // real worker is used when one owns this workflow, so its name and
      // input fields still apply.
      worker:
        owner ?? {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description ?? "",
          category: "workflow",
          workflows: [workflow.id],
          inputs: [],
        },
      workflowId: workflow.id,
      workflowInstalled: true,
      steps: workflow.definition.nodes.length,
    };
  };

  return {
    runner,
    workers,
    home,
    databasePath,
    traces,

    /**
     * Resolves the name the same way `run` does, then hands the manifest to
     * the product boundary. Passing the manifest rather than the id is what
     * keeps a workflow no worker owns routable — its synthesised manifest is
     * in no catalogue, so a lookup by id would refuse it.
     */
    routeTask(request) {
      const resolved = resolveName(request.workerId);

      if (resolved === null) return taskRouter.route(request);

      return taskRouter.routeWorker(resolved.worker, request);
    },

    resolve: resolveName,

    listWorkflows() {
      return [...workflows.values()].map((workflow) => ({
        workflowId: workflow.id,
        name: workflow.name,
        description: workflow.description ?? "",
        steps: workflow.definition.nodes.map((node) => node.id),
      }));
    },

    onProgress(listener) {
      listeners.push(listener);
    },

    close: () => store.close(),
  };
}

function workflowIdOf(events: readonly ExecutionEvent[]): string {
  for (const event of events) {
    const workflowId = event.payload?.workflowId;
    if (typeof workflowId === "string" && workflowId.length > 0) {
      return workflowId;
    }
  }

  return "";
}

/** Reuse a node's prior output when the change set does not reach it. */
function createReuseResolver(
  workflows: ReadonlyMap<string, WorkflowPackage>,
  artifactStore: FileArtifactStore,
  repository: FileExecutionRepository,
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
