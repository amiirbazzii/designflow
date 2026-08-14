// workflows/workflow-design-to-code/src/visual-convergence/test/support/convergence-host.ts
//
// A fully wired host for the internal V2 convergence stage. Test-only, like
// the V2-5.1 host it mirrors: the one place in this feature that touches the
// engine and the agents package, excluded from the build.
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

import { designToCodeV2ConvergenceWorkflowPackage } from "../../visual-convergence-workflow";
import type { VisualRepairBuilder } from "../../visual-convergence-types";
import type { FakeElement } from "../../../v2-visual/test/support/spendly-v2-fixture";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

export interface ConvergenceHost {
  readonly runner: WorkflowRunner;
  readonly artifactStore: InMemoryArtifactStore;
  readonly events: ExecutionEvent[];
  /** How many times the browser seam captured — one per fresh render. */
  readonly captureCount: () => number;
}

/**
 * A renderer whose DOM changes per render, the way a repaired proposal's
 * would. Each capture consumes the next scripted DOM; the last one repeats.
 */
export function queuedRenderer(domQueue: readonly (readonly FakeElement[])[], onCapture?: () => void) {
  let calls = 0;
  return {
    calls: () => calls,
    renderer: {
      async capture(_url: string, viewport: { width: number; height: number }) {
        const elements = domQueue[Math.min(calls, domQueue.length - 1)]!;
        calls += 1;
        onCapture?.();
        return {
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          width: viewport.width,
          height: viewport.height,
          consoleErrors: [],
          runtimeErrors: [],
          failedResources: [],
          warnings: [],
          dom: {
            elements: elements.map((element, index) => ({
              selector: element.selector,
              tagName: element.tagName,
              ancestorPath: ["body", "main"],
              siblingIndex: index,
              ...(element.instrumentationRef !== undefined ? { instrumentationRef: element.instrumentationRef } : {}),
              ...(element.text !== undefined ? { text: element.text } : {}),
              x: 0,
              y: index * 100,
              width: element.width ?? 358,
              height: element.height,
            })),
            overflow: [],
          },
        };
      },
      async close() {},
    },
  };
}

export function createConvergenceHost(options: {
  readonly renderer: unknown;
  readonly repairBuilder?: VisualRepairBuilder;
  readonly captureCount?: () => number;
}): ConvergenceHost {
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
  designToCodeV2ConvergenceWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [designToCodeV2ConvergenceWorkflowPackage.id, designToCodeV2ConvergenceWorkflowPackage],
  ]);

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    capabilityConfig: {
      visualRenderer: options.renderer,
      // The real deterministic evaluator, injected the way a composition root
      // would inject it. The workflow package never imports it.
      visualEvaluator: (input: Parameters<typeof evaluateRenderedState>[0]) => evaluateRenderedState(input),
      ...(options.repairBuilder !== undefined ? { visualRepairBuilder: options.repairBuilder } : {}),
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

  return { runner, artifactStore, events, captureCount: options.captureCount ?? (() => 0) };
}
