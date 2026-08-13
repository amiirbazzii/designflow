// workflows/workflow-design-to-code/src/v2-visual/test/support/v2-visual-host.ts
//
// A fully wired host for the internal V2 visual stage.
//
// Test-only, like `test/support/harness.ts`: it is the one place in this
// feature that touches the engine and the agents package, it is excluded from
// the build, and it exists because proving the stage runs means running it.
import {
  CapabilityRegistry,
  ExecutionService,
  InMemoryApprovalManager,
  InMemoryArtifactStore,
  InMemoryEventPublisher,
  InMemoryExecutionRepository,
} from "@designflow/core";
import { InMemoryExecutionEventCollector, WorkflowRunner } from "@designflow/product";
import { evaluateRenderedState } from "@designflow/agents";
import type { ExecutionEvent, Logger, WorkflowPackage } from "@designflow/sdk";

import { designToCodeV2VisualWorkflowPackage } from "../../v2-visual-workflow";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

export interface V2VisualHost {
  readonly runner: WorkflowRunner;
  readonly service: ExecutionService;
  readonly artifactStore: InMemoryArtifactStore;
  readonly events: ExecutionEvent[];
  /** Critic invocations, so a test can prove no model was reached. */
  readonly criticCalls: unknown[];
}

export function createV2VisualHost(options?: {
  readonly renderer?: unknown;
  /** Omit to run the stage with no evaluator configured at all. */
  readonly evaluator?: unknown;
  readonly critic?: (evidence: unknown) => Promise<unknown>;
}): V2VisualHost {
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
  designToCodeV2VisualWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [designToCodeV2VisualWorkflowPackage.id, designToCodeV2VisualWorkflowPackage],
  ]);

  const criticCalls: unknown[] = [];

  // The real deterministic evaluator, injected exactly the way a composition
  // root would inject it. The workflow package never imports it.
  const evaluator =
    options !== undefined && "evaluator" in options
      ? options.evaluator
      : async (input: Parameters<typeof evaluateRenderedState>[0]) =>
          evaluateRenderedState({
            ...input,
            ...(options?.critic !== undefined
              ? {
                  critic: async (evidence: unknown) => {
                    criticCalls.push(evidence);
                    return options.critic!(evidence);
                  },
                }
              : {}),
          });

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    capabilityConfig: {
      ...(options?.renderer !== undefined ? { visualRenderer: options.renderer } : {}),
      ...(evaluator !== undefined ? { visualEvaluator: evaluator } : {}),
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

  return { runner, service, artifactStore, events, criticCalls };
}
