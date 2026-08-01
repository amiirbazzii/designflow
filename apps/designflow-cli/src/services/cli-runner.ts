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
  AgentSessionService,
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
  designEngineerDefaultModelProfile,
  modelDesignEngineerStrategy,
} from "@designflow/agents";
import { ToolRuntime, createToolRegistry } from "@designflow/tools";
import {
  InMemoryModelProfileRegistry,
  InMemoryModelProviderRegistry,
  ModelRuntime,
  mergeModelProfileOverrides,
} from "@designflow/models";
import { OpenRouterProvider } from "@designflow/model-provider-openrouter";
import type { ModelProfile } from "@designflow/sdk";
import {
  FileApprovalManager,
  FileArtifactStore,
  FileExecutionEventStore,
  FileExecutionRepository,
  FileSessionStore,
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
import { readModelProfileOverrides } from "./model-config";
import { readSessionConfig } from "./session-config";
import type { SessionConfig } from "./session-config";

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

/**
 * The model each installed agent is assigned by default, before any local
 * override.
 *
 * Collected from the agent packages themselves — one entry per agent that
 * ships one, imported rather than reconstructed — so this file never repeats
 * an agent's own profile id or model choice. A worker/agent name appearing in
 * `services/cli-runner.ts` is exactly the mistake this list exists to avoid;
 * see `shell.test.ts`'s scan for why.
 */
const BUILT_IN_MODEL_PROFILES: readonly ModelProfile[] = [designEngineerDefaultModelProfile];

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

/**
 * A worker's AI, in the vocabulary `designflow settings` shows.
 *
 * Safe by construction rather than by care taken when building it: nothing
 * here is capable of holding a credential, because the profile it is built
 * from — `ModelProfile` — has no field for one at all. `credentialConfigured`
 * is a boolean, never the value it is reporting on.
 */
export interface ModelAssignment {
  readonly workerName: string;
  readonly providerId: string;
  readonly model: string;
  readonly credentialConfigured: boolean;
}

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
  /**
   * Agent Sessions — resumable clarification state.
   *
   * The only way a command starts or resumes work that might need a
   * clarifying question answered. `routeTask` above still exists for a
   * caller that genuinely wants one bounded decision and nothing else;
   * `run` uses `sessions` so a `request_clarification` decision has
   * somewhere to go instead of ending the process.
   */
  readonly sessions: AgentSessionService;
  /** Turn limit and expiration in effect for this installation, for `designflow settings` to display. */
  readonly sessionConfig: SessionConfig;
  /**
   * What AI each worker is assigned, for `designflow settings` to display.
   *
   * Computed once, at wiring time, from the same profiles the live model
   * layer (if any) was actually built from — so this can never drift from
   * what a run would really use, the way a second, hand-maintained summary
   * could.
   */
  readonly modelAssignments: readonly ModelAssignment[];
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
  /**
   * Test-only. Overrides the OpenRouter endpoint a real request would go to.
   *
   * The highest precedence in the model configuration hierarchy — explicit
   * dependency injection, never read from `config.json` or an environment
   * variable. That asymmetry is deliberate: a local config or env override
   * for the endpoint would let a compromised or careless config point a real
   * install at an unreviewed server and have its credential sent there. A
   * test, in contrast, calls this function directly and can simply pass the
   * override in — no config file, no env var, no surface for anything else
   * to reach.
   */
  readonly modelEndpointOverride?: string;
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

  // Model profiles: registered whether or not a credential is configured, so
  // `designflow settings` can always show what *would* run — but a live
  // `ModelRuntime` is only ever built when `OPENROUTER_API_KEY` is actually
  // present. This is the one and only place mode is decided, and it is
  // decided once, at wiring time, never per-request and never by falling back
  // silently after a failed attempt.
  const modelProfiles = new InMemoryModelProfileRegistry(
    mergeModelProfileOverrides(BUILT_IN_MODEL_PROFILES, readModelProfileOverrides(home.config)),
  );

  // `!== undefined` rather than a truthiness check: a credential set to an
  // empty string is a real, if broken, signal that OpenRouter was expected —
  // it still reaches `OpenRouterProvider`'s constructor, which refuses an
  // empty key immediately with `ERR_MODEL_API_KEY_MISSING`, before any
  // command has run. An unset variable, in contrast, means OpenRouter was
  // never expected at all, and the CLI stays in deterministic mode with no
  // error of any kind.
  const openRouterApiKey = process.env["OPENROUTER_API_KEY"];
  const modelModeRequested = openRouterApiKey !== undefined;

  const modelRuntime = modelModeRequested
    ? new ModelRuntime({
        profiles: modelProfiles,
        providers: new InMemoryModelProviderRegistry([
          new OpenRouterProvider({
            apiKey: openRouterApiKey,
            ...(options?.modelEndpointOverride !== undefined
              ? { endpoint: options.modelEndpointOverride }
              : {}),
          }),
        ]),
        logger: silentLogger,
      })
    : undefined;

  // Agents decide; they do not execute. The runtime is handed the installed
  // workflow ids and nothing else — no repository, no artifact store, no
  // execution service — so an agent can name a workflow and can do nothing
  // with the name itself.
  const agentRegistry = createAgentRegistry({
    designEngineerStrategy: modelModeRequested ? modelDesignEngineerStrategy : undefined,
  });

  // Traces share the same document as executions, so a run and the decision
  // that started it are written in one atomic rename.
  const traceStore = new FileTraceStore(store);
  const traces = new TraceService(traceStore);

  const agentRuntime = new AgentRuntime({
    registry: agentRegistry,
    availableWorkflows: [...workflows.keys()],
    tools: toolRuntime,
    ...(modelRuntime !== undefined ? { models: modelRuntime } : {}),
    tracer: new TraceCollector(traceStore),
    logger: silentLogger,
  });

  // Safe assignments for `designflow settings` — computed from the same
  // registered profiles a real call would resolve, so this can never show
  // something a run would not actually use.
  const modelAssignments: ModelAssignment[] = [];
  for (const worker of workers.listWorkers()) {
    if (worker.agentId === undefined) continue;

    const agentManifest = agentRegistry.get(worker.agentId)?.manifest;
    if (agentManifest?.modelProfileId === undefined) continue;

    const profile = modelProfiles.get(agentManifest.modelProfileId);
    if (profile === undefined) continue;

    modelAssignments.push({
      workerName: worker.name,
      providerId: profile.providerId,
      model: profile.model,
      credentialConfigured: modelModeRequested && openRouterApiKey.trim().length > 0,
    });
  }

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

  // Sessions share the same document as executions and traces, so a session,
  // the run it starts and the trace behind it are all written in one atomic
  // rename.
  const sessionConfig = readSessionConfig(home.config);
  const sessionStore = new FileSessionStore(store);
  const sessions = new AgentSessionService({
    store: sessionStore,
    workers,
    router: taskRouter,
    runner,
    traces,
    maxClarificationTurns: sessionConfig.maxClarificationTurns,
    expirationDays: sessionConfig.expirationDays,
    resolveModelProfileId: (agentId) => agentRegistry.get(agentId)?.manifest.modelProfileId,
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
    sessions,
    sessionConfig,
    modelAssignments,

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
