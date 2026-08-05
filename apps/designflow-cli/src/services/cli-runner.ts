// apps/designflow-cli/src/services/cli-runner.ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  ArtifactSetReconciler,
  CapabilityRegistry,
  createArtifactFingerprintReuseResolver,
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
  ArtifactInspectionService,
  ProjectService,
  ProjectContextService,
  AgentMemoryService,
  MemoryProposalService,
  ContextAssemblyService,
  buildProgress,
  type ExecutionProgress,
  type SessionClock,
  type WorkerTaskRequest,
  type WorkerTaskResult,
} from "@designflow/product";

import {
  AgentRuntime,
  AgentInvocationRuntime,
  assertWorkerAgentAlignment,
  createAgentRegistry,
  createSpecializedAgentRegistry,
  designEngineerDefaultModelProfile,
  modelDesignEngineerStrategy,
  designEngineerCoordinatorDefaultModelProfile,
  qaReviewerDefaultModelProfile,
  modelQaReviewerStrategy,
  researchAnalystDefaultModelProfile,
  modelResearchAnalystStrategy,
  productManagerDefaultModelProfile,
  modelProductManagerStrategy,
  figmaSpecificationDefaultModelProfile,
  modelFigmaSpecificationStrategy,
  implementationDefaultModelProfile,
  modelImplementationStrategy,
  visualValidationDefaultModelProfile,
  modelVisualValidationStrategy,
  visualCorrectionDefaultModelProfile,
  modelVisualCorrectionStrategy,
} from "@designflow/agents";
import { HttpMcpRuntime, McpRuntime } from "@designflow/mcp";
import {
  ToolRuntime,
  createToolRegistry,
  createProjectInspector,
} from "@designflow/tools";
import {
  InMemoryModelProfileRegistry,
  InMemoryModelProviderRegistry,
  ModelRuntime,
  mergeModelProfileOverrides,
} from "@designflow/models";
import { OpenRouterProvider } from "@designflow/model-provider-openrouter";
import {
  type ModelProfile,
  primaryWorkflowOf,
  type ExecutionEvent,
  type Logger,
  type WorkerManifest,
  type WorkflowPackage,
  type RegistryArtifactStore,
} from "@designflow/sdk";
import {
  FileAgentMemoryStore,
  FileApprovalManager,
  FileArtifactStore,
  FileExecutionEventStore,
  FileExecutionRepository,
  FileMemoryProposalStore,
  FileFeedbackLoopParentStore,
  FileProjectContextStore,
  FileProjectStore,
  FileSessionStore,
  FileStore,
  FileTraceStore,
  inspectStateFile,
  type StateHealthReport,
} from "@designflow/storage-file";

import {
  createWorkerRegistry,
  type InMemoryWorkerRegistry,
} from "@designflow/workers";

import {
  designToCodeApprovalPolicy,
  designToCodeWorkflowPackage,
  designToCodeFigmaSpecificationWorkflowPackage,
  designToCodeImplementationWorkflowPackage,
  sharedFigmaSpecificationCapabilities,
  storeStage3SummaryCapability,
  implementationCapabilities,
  implementationSideEffectCapabilities,
  visualValidationCapabilities,
  designToCodeImplementationApprovalPolicy,
  designToCodeFeedbackLoopWorkflowPackage,
  designToCodeFeedbackLoopApprovalPolicy,
  feedbackLoopWorkflowInputSchema,
  inspectRegisteredProject,
} from "@designflow/workflow-design-to-code";
import {
  qaReviewApprovalPolicy,
  qaReviewWorkflowPackage,
} from "@designflow/workflow-qa-review";
import {
  researchAnalysisApprovalPolicy,
  researchAnalysisWorkflowPackage,
} from "@designflow/workflow-research-analysis";
import {
  productBriefApprovalPolicy,
  productBriefWorkflowPackage,
} from "@designflow/workflow-product-brief";
import { resolveDatabasePath } from "./config";
import { initializeHome, type HomeState } from "./home";

import { readModelProfileOverrides } from "./model-config";

/** Internal Stage 6 routing stays in the composition root, not in CLI copy. */
export const FEEDBACK_LOOP_WORKFLOW_ID = "design-to-code-feedback-loop";

export function parseFeedbackLoopInput(input: unknown) {
  return feedbackLoopWorkflowInputSchema.parse(input);
}

export { inspectRegisteredProject };
import {
  readExperimentalFigmaMcpEnabled,
  readExperimentalImplementationEnabled,
  readFigmaMcpConfig,
} from "./figma-mcp-config";

export const EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID = [
  "design",
  "to",
  "code",
  "implementation",
].join("-");

export function registerExperimentalDesignToCodeWorkflows(options: {
  readonly registry: CapabilityRegistry;
  readonly workflows: Map<string, WorkflowPackage>;
  readonly figmaMcpEnabled: boolean;
  readonly implementationEnabled: boolean;
}): void {
  // Shared Figma capabilities are registered exactly once here. The workflow
  // manifests deliberately register only their stage-specific capabilities.
  for (const capability of sharedFigmaSpecificationCapabilities) {
    options.registry.register(capability);
  }

  if (options.figmaMcpEnabled) {
    options.registry.register(storeStage3SummaryCapability);
    options.workflows.set(
      designToCodeFigmaSpecificationWorkflowPackage.id,
      designToCodeFigmaSpecificationWorkflowPackage,
    );
  }
  if (options.implementationEnabled) {
    for (const capability of [
      ...implementationCapabilities,
      ...implementationSideEffectCapabilities,
      ...visualValidationCapabilities,
    ]) {
      options.registry.register(capability);
    }
    options.workflows.set(
      designToCodeImplementationWorkflowPackage.id,
      designToCodeImplementationWorkflowPackage,
    );
    designToCodeFeedbackLoopWorkflowPackage.load(options.registry);
    options.workflows.set(
      designToCodeFeedbackLoopWorkflowPackage.id,
      designToCodeFeedbackLoopWorkflowPackage,
    );
  }
}
import { readSessionConfig, type SessionConfig } from "./session-config";

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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
const BUILT_IN_MODEL_PROFILES: readonly ModelProfile[] = [
  designEngineerDefaultModelProfile,
  designEngineerCoordinatorDefaultModelProfile,
  qaReviewerDefaultModelProfile,
  researchAnalystDefaultModelProfile,
  productManagerDefaultModelProfile,
  // Registered unconditionally, exactly like every other worker's profile
  // above — `designflow settings` can always show what a preview run
  // *would* use, whether or not the experimental flag that actually wires
  // a live Figma MCP connection is on.
  figmaSpecificationDefaultModelProfile,
  implementationDefaultModelProfile,
  visualValidationDefaultModelProfile,
  visualCorrectionDefaultModelProfile,
];

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

/**
 * What `designflow cleanup` did, for the command to render.
 *
 * Only ever reports sessions and approvals moved into a terminal `expired`
 * state — nothing here is ever deleted, and completed history is never
 * touched. See `cleanup` on `CliContext` for the guarantee this reports on.
 */
export interface CleanupReport {
  /** Sessions this run moved from a stale `active`/`waiting_for_user` into `expired`. */
  readonly expiredSessionIds: readonly string[];
  /** Approval requests this run moved from a stale `pending` into `expired`. */
  readonly expiredApprovalIds: readonly string[];
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
  /** True when the composition root found a non-empty live provider credential. */
  readonly modelProviderConfigured: boolean;
  /** Read-only state health inspection, kept behind the composition boundary. */
  readonly inspectState: () => StateHealthReport;
  /** True when an explicit project can select the experimental implementation path. */
  readonly experimentalImplementationEnabled: boolean;
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
   * Reads back an artifact's stored payload for `designflow artifacts`.
   *
   * A read boundary over the same registry and payload store the engine
   * writes through — redacting anything credential-shaped before it ever
   * reaches a terminal, a trace, or a saved transcript.
   */
  readonly artifactInspection: ArtifactInspectionService;
  readonly artifactStore: RegistryArtifactStore;
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
  /** Durable, inspectable project registry — `designflow projects`. */
  readonly projects: ProjectService;
  /** A project's accumulated facts — `designflow projects show`. */
  readonly projectContext: ProjectContextService;
  /** Durable, explicitly approved agent memory — `designflow memory`. */
  readonly memory: AgentMemoryService;
  /** Agent-proposed memory awaiting approval — `designflow memory proposals`. */
  readonly memoryProposals: MemoryProposalService;
  readonly feedbackLoopParents: FileFeedbackLoopParentStore;
  /**
   * Agent names a person may address in `designflow memory add --agent`.
   *
   * Computed once at wiring time, from the same registered agents a real
   * session would resolve — the same "cannot drift from what a run would
   * actually use" discipline `modelAssignments` already follows. Names only:
   * internal agent ids are never shown.
   */
  readonly agentDirectory: readonly {
    readonly name: string;
    readonly id: string;
  }[];
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
  /**
   * Marks stale, unresumable state as `expired` — `designflow cleanup`.
   *
   * Deterministic and idempotent: a session or approval past its
   * `expiresAt` is marked once and reported once; running this again with
   * nothing newly stale returns an empty report rather than re-reporting the
   * same ones. Never deletes anything and never touches a `completed`
   * session or a decided (`approved`/`rejected`) approval — this only ever
   * moves transient, still-pending state into its own terminal status.
   */
  cleanup(): Promise<CleanupReport>;
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
  /**
   * Test-only. Overrides the clock `AgentSessionService` uses to stamp and
   * evaluate `expiresAt`.
   *
   * `readSessionConfig` only accepts a positive `expirationDays` — zero is
   * refused, on purpose, so a config typo cannot make every session expire
   * on arrival — so there is no way to make a session stale *immediately*
   * through config alone. This is the same seam `modelEndpointOverride`
   * already is: explicit dependency injection a test reaches by calling this
   * function directly, with no config file or env var able to reach it.
   */
  readonly sessionClockOverride?: SessionClock;
}

export function createCliContext(options?: CliContextOptions): CliContext {
  // First: lay out `~/.designflow`. Everything below needs somewhere to write,
  // and a fresh install has nowhere until this runs.
  const home = initializeHome();
  const databasePath =
    options?.databasePath ?? resolveDatabasePath(home.config);

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

  // An approval's own default expiration reuses the same `expirationDays`
  // config a session already reads — one expiration policy per installation,
  // not two that could quietly disagree. Read once, early, since both
  // `approvals` and `sessions` below need it.
  const sessionConfig = readSessionConfig(home.config);
  const approvals = new FileApprovalManager(store, {
    defaultExpirationMs: sessionConfig.expirationDays * ONE_DAY_MS,
  });

  const capabilityRegistry = new CapabilityRegistry();
  const workflows = new Map<string, WorkflowPackage>();
  const workers = options?.workers ?? createWorkerRegistry();

  // `!== undefined` rather than a truthiness check: a credential set to an
  // empty string is a real, if broken, signal that OpenRouter was expected —
  // it still reaches `OpenRouterProvider`'s constructor, which refuses an
  // empty key immediately with `ERR_MODEL_API_KEY_MISSING`, before any
  // command has run. An unset variable, in contrast, means OpenRouter was
  // never expected at all, and the CLI stays in deterministic mode with no
  // error of any kind. Read here, ahead of `service`, rather than closer to
  // `agentRegistry` below, because Stage 3's experimental wiring (also
  // below) needs the same decision to toggle the Figma Specification
  // Agent's strategy.
  const openRouterApiKey = process.env["OPENROUTER_API_KEY"];
  const modelModeRequested = openRouterApiKey !== undefined;

  // Stage 3: the experimental Figma MCP path. Off unless a local config
  // explicitly sets `settings.experimental.designEngineerFigmaMcp` — every
  // existing worker, workflow and command is unaffected either way. See
  // `docs/adr/*-figma-mcp-integration.md` for the full rollout rationale.
  const implementationEnabled = readExperimentalImplementationEnabled(
    home.config,
  );
  const figmaMcpEnabled =
    readExperimentalFigmaMcpEnabled(home.config) || implementationEnabled;
  const figmaMcpConfig = figmaMcpEnabled
    ? readFigmaMcpConfig(home.config)
    : undefined;

  const mcpClient =
    figmaMcpConfig !== undefined
      ? figmaMcpConfig.transport === "http"
        ? new HttpMcpRuntime({
            url: figmaMcpConfig.url,
            ...(figmaMcpConfig.connectTimeoutMs !== undefined
              ? { connectTimeoutMs: figmaMcpConfig.connectTimeoutMs }
              : {}),
            ...(figmaMcpConfig.requestTimeoutMs !== undefined
              ? { requestTimeoutMs: figmaMcpConfig.requestTimeoutMs }
              : {}),
            ...(figmaMcpConfig.maxResponseBytes !== undefined
              ? { maxResponseBytes: figmaMcpConfig.maxResponseBytes }
              : {}),
            serverIdentity: "figma-desktop-mcp",
          })
        : new McpRuntime({
            command: figmaMcpConfig.command,
            args: figmaMcpConfig.args,
            env: figmaMcpConfig.env,
            ...(figmaMcpConfig.connectTimeoutMs !== undefined
              ? { connectTimeoutMs: figmaMcpConfig.connectTimeoutMs }
              : {}),
            ...(figmaMcpConfig.requestTimeoutMs !== undefined
              ? { requestTimeoutMs: figmaMcpConfig.requestTimeoutMs }
              : {}),
            ...(figmaMcpConfig.maxResponseBytes !== undefined
              ? { maxResponseBytes: figmaMcpConfig.maxResponseBytes }
              : {}),
            serverIdentity: "figma-mcp",
          })
      : undefined;

  // A dedicated `AgentInvocationRuntime`, independent of the coordinator's
  // `AgentRuntime` below — Stage 2's own boundary between "decides a route"
  // and "invoked by a workflow node for its output" carries through here.
  const figmaAgentInvocationRuntime = figmaMcpEnabled
    ? new AgentInvocationRuntime({
        registry: createSpecializedAgentRegistry({
          figmaSpecificationStrategy: modelModeRequested
            ? modelFigmaSpecificationStrategy
            : undefined,
          implementationStrategy:
            implementationEnabled && modelModeRequested
              ? modelImplementationStrategy
              : undefined,
          visualValidationStrategy: modelModeRequested
            ? modelVisualValidationStrategy
            : undefined,
          visualCorrectionStrategy: modelModeRequested
            ? modelVisualCorrectionStrategy
            : undefined,
        }),
      })
    : undefined;

  for (const workflowPackage of [
    designToCodeWorkflowPackage,
    qaReviewWorkflowPackage,
    researchAnalysisWorkflowPackage,
    productBriefWorkflowPackage,
  ]) {
    workflowPackage.load(capabilityRegistry);
    workflows.set(workflowPackage.id, workflowPackage);
  }
  registerExperimentalDesignToCodeWorkflows({
    registry: capabilityRegistry,
    workflows,
    figmaMcpEnabled,
    implementationEnabled,
  });

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
          // One combined policy across every installed workflow. Safe to
          // concatenate rather than pick one: each workflow's `target` is
          // that workflow's own step id, and step ids are unique across the
          // four built-in workflows, so no rule can ever match a step it was
          // not written for.
          policy: {
            id: "combined-approval",
            name: "Combined approval gate",
            rules: [
              ...designToCodeApprovalPolicy.rules,
              ...qaReviewApprovalPolicy.rules,
              ...researchAnalysisApprovalPolicy.rules,
              ...productBriefApprovalPolicy.rules,
              ...designToCodeImplementationApprovalPolicy.rules,
              ...designToCodeFeedbackLoopApprovalPolicy.rules,
            ],
          },
          policyEvaluator: new InMemoryPolicyEvaluator(),
        }
      : {}),
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
    executionReconciler: new ArtifactSetReconciler({ registry: artifactStore }),
    ...(mcpClient !== undefined ? { mcpClient } : {}),
    ...(figmaAgentInvocationRuntime !== undefined
      ? { agentInvoker: figmaAgentInvocationRuntime }
      : {}),
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
    mergeModelProfileOverrides(
      BUILT_IN_MODEL_PROFILES,
      readModelProfileOverrides(home.config),
    ),
  );

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
    designEngineerStrategy: modelModeRequested
      ? modelDesignEngineerStrategy
      : undefined,
    // The coordinator shares the design-engineer-agent alias's decision
    // logic (see `design-engineer-coordinator.ts`), so it toggles model mode
    // the same way, from the same single wiring-time decision.
    designEngineerCoordinatorStrategy: modelModeRequested
      ? modelDesignEngineerStrategy
      : undefined,
    qaReviewerStrategy: modelModeRequested
      ? modelQaReviewerStrategy
      : undefined,
    researchAnalystStrategy: modelModeRequested
      ? modelResearchAnalystStrategy
      : undefined,
    productManagerStrategy: modelModeRequested
      ? modelProductManagerStrategy
      : undefined,
  });

  // Traces share the same document as executions, so a run and the decision
  // that started it are written in one atomic rename.
  const traceStore = new FileTraceStore(store);
  const traces = new TraceService(traceStore);

  // The same file-backed store serves as both the payload store and the
  // artifact registry, so this reads exactly what the engine wrote — nothing
  // reconstructed, nothing a second store could disagree with.
  const artifactInspection = new ArtifactInspectionService({
    artifactRegistry: artifactStore,
    artifactStore,
  });

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
      credentialConfigured:
        modelModeRequested && openRouterApiKey.trim().length > 0,
    });
  }

  // A worker that advertises work its agent may never choose is a
  // configuration mistake. Caught here, at wiring time, rather than on the
  // first run that happens to hit the offending workflow.
  for (const worker of workers.listWorkers()) {
    if (worker.agentId === undefined) continue;
    assertWorkerAgentAlignment(
      worker,
      agentRegistry.require(worker.agentId).manifest,
    );
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
    resolveWorkflowStepCount: (id) =>
      workflows.get(id)?.definition.nodes.length,
  });

  // Projects and Agent Memory (Stage 40) — durable, product-level knowledge,
  // sharing the same document for the same reason sessions/traces do: a
  // project, the memory approved for it and the session that consulted both
  // are all written in one atomic rename.
  const projectStore = new FileProjectStore(store);
  const projectContextStore = new FileProjectContextStore(store);
  const memoryStore = new FileAgentMemoryStore(store);
  const memoryProposalStore = new FileMemoryProposalStore(store);
  const feedbackLoopParents = new FileFeedbackLoopParentStore(store);

  const projectContext = new ProjectContextService({
    store: projectContextStore,
  });
  const projects = new ProjectService({
    store: projectStore,
    context: projectContext,
    // `createProjectInspector` reads only a project's own, previously
    // registered `rootPath` — never a directory named at call time — so
    // granting it here is not the same widening `project-summary`'s absence
    // above is guarding against.
    inspector: createProjectInspector(),
  });
  const memory = new AgentMemoryService({ store: memoryStore });
  const memoryProposals = new MemoryProposalService({
    store: memoryProposalStore,
    memory,
  });

  const knowledge = new ContextAssemblyService({
    projectContext: {
      getProject: (id) => projects.getProject(id),
      getContext: (id) => projectContext.getContext(id),
    },
    memory: { listMemory: (filters) => memory.listMemory(filters) },
  });

  // Named by *worker*, not by the agent manifest's own `name` — a person
  // addresses "Design Engineer" (`designflow list`'s vocabulary) and has
  // never heard of "Design Engineer Agent" (the manifest's internal name).
  // Deduped by agent id, since more than one worker could in principle
  // delegate to the same agent.
  const agentDirectory: { name: string; id: string }[] = [];
  const seenAgentIds = new Set<string>();
  for (const worker of workers.listWorkers()) {
    if (worker.agentId === undefined || seenAgentIds.has(worker.agentId))
      continue;
    if (agentRegistry.get(worker.agentId) === undefined) continue;
    seenAgentIds.add(worker.agentId);
    agentDirectory.push({ name: worker.name, id: worker.agentId });
  }

  // Sessions share the same document as executions and traces, so a session,
  // the run it starts and the trace behind it are all written in one atomic
  // rename. `sessionConfig` was already read above, for `approvals`.
  const sessionStore = new FileSessionStore(store);
  const sessions = new AgentSessionService({
    store: sessionStore,
    workers,
    router: taskRouter,
    runner,
    traces,
    maxClarificationTurns: sessionConfig.maxClarificationTurns,
    expirationDays: sessionConfig.expirationDays,
    resolveModelProfileId: (agentId) =>
      agentRegistry.get(agentId)?.manifest.modelProfileId,
    resolveAgentVersion: (agentId) =>
      agentRegistry.get(agentId)?.manifest.version,
    knowledge,
    ...(options?.sessionClockOverride !== undefined
      ? { clock: options.sessionClockOverride }
      : {}),
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

    if (name === "design-to-code-implementation") {
      return {
        worker: {
          id: workflow.id,
          name: workflow.name,
          description: workflow.description ?? "",
          category: "workflow",
          workflows: [workflow.id],
          inputs: [
            {
              key: "designFile",
              label: "Figma design URL",
              placeholder: "https://www.figma.com/design/...",
            },
            {
              key: "frames",
              label: "Frames",
              placeholder: "432-2906",
              list: true,
            },
            {
              key: "projectId",
              label: "Registered project ID",
              placeholder: "project-id",
            },
          ],
          evaluationCriteria: [],
        },
        workflowId: workflow.id,
        workflowInstalled: true,
        steps: workflow.definition.nodes.length,
      };
    }

    return {
      // Synthesised so the caller has one shape to render either way. The
      // real worker is used when one owns this workflow, so its name and
      // input fields still apply.
      worker: owner ?? {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description ?? "",
        category: "workflow",
        workflows: [workflow.id],
        inputs: [],
        evaluationCriteria: [],
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
    modelProviderConfigured: modelModeRequested && openRouterApiKey !== undefined && openRouterApiKey.trim().length > 0,
    inspectState: () => inspectStateFile(databasePath),
    experimentalImplementationEnabled: implementationEnabled,
    traces,
    artifactInspection,
    artifactStore,
    sessions,
    sessionConfig,
    modelAssignments,
    projects,
    projectContext,
    memory,
    memoryProposals,
    feedbackLoopParents,
    agentDirectory,

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

    async cleanup() {
      const expiredSessions = await sessions.cleanupExpiredSessions();
      const expiredApprovals = await approvals.expireStale(Date.now());

      return {
        expiredSessionIds: expiredSessions.map((session) => session.id),
        expiredApprovalIds: expiredApprovals.map((approval) => approval.id),
      };
    },

    close: () => {
      mcpClient?.close?.();
      store.close();
    },
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
