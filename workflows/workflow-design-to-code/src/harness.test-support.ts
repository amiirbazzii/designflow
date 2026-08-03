// workflows/workflow-design-to-code/src/harness.test-support.ts
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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
import {
  AgentInvocationRuntime,
  createSpecializedAgentRegistry,
  type SpecializedAgentCatalogOptions,
} from "@designflow/agents";
import { designToCodeWorkflowPackage } from "./manifest";
import { designToCodeAgentFoundationWorkflowPackage } from "./agent-foundation-manifest";
import { designToCodeFigmaSpecificationWorkflowPackage } from "./figma-specification-manifest";

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

// ── Stage 2: Agent Foundation host ───────────────────────────────

export interface AgentFoundationHost extends DesignToCodeHost {
  readonly agents: AgentInvocationRuntime;
}

/**
 * A host for `design-to-code-agent-foundation`, wiring a real
 * `AgentInvocationRuntime` in as the engine's `agentInvoker`.
 *
 * Deterministic by default (no `models`/`tools` passed to the specialized
 * agent registry), so these tests run offline exactly like every other test
 * in this package. `strategies` lets a test opt one specific agent into a
 * fake model-backed strategy without touching the others, for tests that
 * need to exercise the model-invalid-output path.
 */
export function createAgentFoundationHost(options?: {
  readonly strategies?: SpecializedAgentCatalogOptions;
  readonly incremental?: boolean;
}): AgentFoundationHost {
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
  designToCodeAgentFoundationWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [
      designToCodeAgentFoundationWorkflowPackage.id,
      designToCodeAgentFoundationWorkflowPackage,
    ],
  ]);

  const specializedAgents = createSpecializedAgentRegistry(options?.strategies);
  const agents = new AgentInvocationRuntime({ registry: specializedAgents });

  const incremental = options?.incremental === true;

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    agentInvoker: agents,
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
    agents,
  };
}

/** A representative Agent Foundation workflow input, ready to run as-is. */
export const SAMPLE_AGENT_FOUNDATION_INPUT = {
  figmaSnapshotSeed: {
    designFile: "homepage.fig",
    frames: ["brand/Header", "brand/Footer", "layout/Sidebar"],
  },
  projectContext: {
    projectRootIdentity: "project-fixture",
    framework: "react",
    sourceRoot: "src/components",
    stylingStrategy: "css-modules",
    existingComponentReferences: [],
    designSystemReferences: [],
    contextFingerprint: "fixture-context-v1",
  },
  validationThreshold: 0.8,
  figmaAgentVersion: "0.1.0",
  implementationAgentVersion: "0.1.0",
  visualValidationAgentVersion: "0.1.0",
};

/** A design with three frames across two token groups. */
export const SAMPLE_DESIGN = {
  designFile: "homepage.fig",
  framework: "react" as const,
  frames: ["brand/Header", "brand/Footer", "layout/Sidebar"],
};

// ── Stage 3: Figma Specification host ────────────────────────────

export interface FigmaSpecificationHost extends DesignToCodeHost {
  readonly agents: AgentInvocationRuntime;
  /** Terminates the fake MCP server's subprocess. Always call this in an `afterEach`. */
  close(): void;
}

const require = createRequire(import.meta.url);

/** The fake MCP server `@designflow/mcp`'s own tests spawn — reused here for the same reason. */
function fakeMcpServerPath(): string {
  const packageDir = fileURLToPath(new URL(".", `file://${require.resolve("@designflow/mcp/package.json")}`));
  return `${packageDir}src/fake-server-entry.ts`;
}

/**
 * A host for `design-to-code-figma-specification`, wiring a real
 * `McpRuntime` (spawning the fake MCP server as a real, separate process)
 * as the engine's `mcpClient`, alongside a real `AgentInvocationRuntime` for
 * the Figma Specification Agent — the same two ports Stage 2's host wires,
 * plus the one Stage 3 adds.
 */
export async function createFigmaSpecificationHost(options?: {
  readonly fixtures?: Record<string, unknown>;
  readonly strategies?: SpecializedAgentCatalogOptions;
  readonly incremental?: boolean;
}): Promise<FigmaSpecificationHost> {
  const { McpRuntime } = await import("@designflow/mcp");

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
  designToCodeFigmaSpecificationWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [
      designToCodeFigmaSpecificationWorkflowPackage.id,
      designToCodeFigmaSpecificationWorkflowPackage,
    ],
  ]);

  const specializedAgents = createSpecializedAgentRegistry(options?.strategies);
  const agents = new AgentInvocationRuntime({ registry: specializedAgents });

  const mcpClient = new McpRuntime({
    command: "bun",
    args: ["run", fakeMcpServerPath()],
    env: { FAKE_MCP_FIXTURES: JSON.stringify(options?.fixtures ?? {}) },
    serverIdentity: "fake-figma-mcp",
  });

  const incremental = options?.incremental === true;

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    agentInvoker: agents,
    mcpClient,
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
    agents,
    close: () => mcpClient.close(),
  };
}

/** A representative Figma Specification workflow input, ready to run as-is. */
export const SAMPLE_FIGMA_SPECIFICATION_INPUT = {
  designFile: "https://www.figma.com/design/abc123XYZ/Homepage",
  frames: ["Header"],
  captureScreenshots: true,
  figmaAgentVersion: "0.2.0",
};

/** A minimal, valid fake-server fixture set: one frame, one variable, one screenshot. */
export const SAMPLE_FIGMA_MCP_FIXTURES: Record<string, unknown> = {
  tools: [
    { name: "get_document", description: "Reads the document" },
    { name: "get_variables", description: "Lists variables" },
    { name: "capture_screenshot", description: "Captures a screenshot" },
  ],
  toolResults: {
    get_document: {
      name: "Homepage",
      version: "1",
      document: {
        id: "0:0",
        name: "Page 1",
        type: "CANVAS",
        children: [
          { id: "1:1", name: "Header", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 96 } },
        ],
      },
    },
    get_variables: { variables: [{ name: "color.brand", value: "#111827" }] },
    capture_screenshot: {
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64"),
      format: "png",
      width: 1440,
      height: 96,
    },
  },
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
