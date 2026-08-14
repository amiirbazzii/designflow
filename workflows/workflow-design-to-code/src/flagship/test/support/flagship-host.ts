// workflows/workflow-design-to-code/src/flagship/test/support/flagship-host.ts
//
// The full product composition for flagship acceptance: worker catalogue,
// session service, workflow runner, real engine, real artifact store —
// exactly the layers `designflow run design-engineer` crosses.
//
// Deliberately wired with NO agent runtime, NO agent invoker and NO MCP-mode
// Figma: the router cannot reach the Coordinator (it would throw), the engine
// cannot reach a specialized agent, and the run still completes — which is
// the structural proof that zero Coordinator and zero legacy-specialist calls
// exist on the normal path. The V2 AI roles arrive as deterministic fakes
// through the same `context.config` seams production uses.
import {
  CapabilityRegistry,
  ExecutionService,
  InMemoryApprovalManager,
  InMemoryArtifactStore,
  InMemoryEventPublisher,
  InMemoryExecutionRepository,
  InMemoryPolicyEvaluator,
} from "@designflow/core";
import {
  AgentSessionService,
  InMemoryExecutionEventCollector,
  InMemorySessionStore,
  WorkerTaskRouter,
  WorkflowRunner,
} from "@designflow/product";
import { createWorkerRegistry, designEngineer } from "@designflow/workers";
import { evaluateRenderedState } from "@designflow/agents";
import type { ExecutionEvent, Logger, WorkflowPackage } from "@designflow/sdk";

import {
  designToCodeV2ApprovalPolicy,
  designToCodeV2WorkflowPackage,
} from "../../flagship-workflow";
import { SAMPLE_FIGMA_MCP_FIXTURES, fakeMcpServerPath } from "../../../../test/support/harness";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

export interface FlagshipHost {
  readonly sessions: AgentSessionService;
  readonly runner: WorkflowRunner;
  readonly service: ExecutionService;
  readonly artifactStore: InMemoryArtifactStore;
  readonly events: ExecutionEvent[];
  readonly worker: typeof designEngineer;
  readonly close: () => void;
}

export async function createFlagshipHost(options: {
  readonly config: Readonly<Record<string, unknown>>;
}): Promise<FlagshipHost> {
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
  designToCodeV2WorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [designToCodeV2WorkflowPackage.id, designToCodeV2WorkflowPackage],
  ]);

  // The same fake, out-of-process Figma MCP server the Stage-3 harness runs
  // — real transport, deterministic fixtures, zero network.
  const mcpClient = new McpRuntime({
    command: "bun",
    args: ["run", fakeMcpServerPath()],
    env: { FAKE_MCP_FIXTURES: JSON.stringify(SAMPLE_FIGMA_MCP_FIXTURES) },
    serverIdentity: "fake-figma-mcp",
  });

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    mcpClient,
    policy: designToCodeV2ApprovalPolicy,
    policyEvaluator: new InMemoryPolicyEvaluator(),
    capabilityConfig: {
      // The real deterministic evaluator by default; tests may override.
      visualEvaluator: (input: Parameters<typeof evaluateRenderedState>[0]) => evaluateRenderedState(input),
      ...options.config,
    },
  });

  const runner = new WorkflowRunner({
    executionContract: service,
    executionRepository: repository,
    eventSource: collector,
    artifactRegistry: artifactStore,
    approvalManager: approvals,
    resolveWorkflowName: (id) => workflows.get(id)?.name,
    resolveWorkflowStepCount: (id) => workflows.get(id)?.definition.nodes.length,
  });

  // The product layer: a real session service over a router with NO agent
  // runtime. Any attempt to route the design-engineer worker through an
  // agent would throw — deterministic dispatch is the only path.
  const workers = createWorkerRegistry();
  const sessions = new AgentSessionService({
    store: new InMemorySessionStore(),
    workers,
    router: new WorkerTaskRouter({ workers }),
    runner,
  });

  return {
    sessions,
    runner,
    service,
    artifactStore,
    events,
    worker: designEngineer,
    close: () => mcpClient.close(),
  };
}
