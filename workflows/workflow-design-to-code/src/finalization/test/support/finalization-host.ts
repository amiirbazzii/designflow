// workflows/workflow-design-to-code/src/finalization/test/support/finalization-host.ts
//
// A fully wired host for the internal V2 finalization stage. Test-only,
// excluded from the build. Deliberately wires NO model, no critic, no builder
// and no renderer: V2-7 is zero-AI by construction, and this host proves the
// whole stage runs without any model seam existing at all.
import {
  CapabilityRegistry,
  ExecutionService,
  InMemoryApprovalManager,
  InMemoryArtifactStore,
  InMemoryEventPublisher,
  InMemoryExecutionRepository,
  InMemoryPolicyEvaluator,
} from "@designflow/core";
import { InMemoryExecutionEventCollector, WorkflowRunner } from "@designflow/product";
import type { ExecutionEvent, Logger, WorkflowPackage } from "@designflow/sdk";

import {
  designToCodeV2FinalizeApprovalPolicy,
  designToCodeV2FinalizeWorkflowPackage,
} from "../../finalization-workflow";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

export interface FinalizationHost {
  readonly runner: WorkflowRunner;
  readonly artifactStore: InMemoryArtifactStore;
  readonly events: ExecutionEvent[];
}

export function createFinalizationHost(): FinalizationHost {
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
  designToCodeV2FinalizeWorkflowPackage.load(capabilityRegistry);

  const workflows = new Map<string, WorkflowPackage>([
    [designToCodeV2FinalizeWorkflowPackage.id, designToCodeV2FinalizeWorkflowPackage],
  ]);

  const service = new ExecutionService({
    workflowResolver: (workflowId) => workflows.get(workflowId),
    capabilityRegistry,
    logger: silentLogger,
    artifactStore,
    executionRepository: repository,
    eventPublisher,
    approvalManager: approvals,
    policy: designToCodeV2FinalizeApprovalPolicy,
    policyEvaluator: new InMemoryPolicyEvaluator(),
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

  return { runner, artifactStore, events };
}
