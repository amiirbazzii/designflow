import type {
  Capability,
  CapabilityNode,
  WorkflowNode,
  WorkflowMetadata,
  ArtifactRef,
} from "@designflow/sdk";

// ── Compiled Workflow ──────────────────────────────────────────────

export interface CompiledCapabilityNode {
  readonly kind: "capability";
  readonly node: CapabilityNode;
  readonly capability: Capability<unknown, unknown>;
  readonly order: number;
}

export interface CompiledWorkflowNode {
  readonly kind: "workflow";
  readonly node: WorkflowNode;
  readonly order: number;
}

export type CompiledNode = CompiledCapabilityNode | CompiledWorkflowNode;

export interface CompiledWorkflow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly metadata: WorkflowMetadata;
  readonly nodes: readonly CompiledNode[];
}

// ── Lifecycle Types ────────────────────────────────────────────────

export interface ExecutionStepBase {
  readonly nodeId: string;
  readonly label: string | undefined;
  readonly inputMap: Readonly<Record<string, unknown>>;
  readonly dependsOn: readonly string[];
}

export interface CapabilityExecutionStep extends ExecutionStepBase {
  readonly kind: "capability";
  readonly capabilityId: string;
}

export interface WorkflowExecutionStep extends ExecutionStepBase {
  readonly kind: "workflow";
  readonly workflowId: string;
}

export type ExecutionStep = CapabilityExecutionStep | WorkflowExecutionStep;

export interface ExecutionLayer {
  readonly index: number;
  readonly nodeIds: readonly string[];
}

export interface ExecutionPlan {
  readonly workflowId: string;
  readonly layers: readonly ExecutionLayer[];
  steps: readonly ExecutionStep[];
  totalSteps: number;
}

/**
 * A parent node that is blocked because its child execution is awaiting a
 * human approval decision. The parent execution is resumable, not failed.
 */
export interface PendingChildApproval {
  readonly nodeId: string;
  readonly childWorkflowId: string;
  readonly childExecutionId: string;
  readonly message: string;
}

export interface ExecutionResult {
  readonly workflowId: string;
  readonly success: boolean;
  readonly artifacts: readonly ArtifactRef[];
  readonly completedSteps: readonly string[];
  readonly failedStep: string | undefined;
  readonly error: unknown;
  readonly pendingApproval: PendingChildApproval | undefined;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface ValidationIssue {
  readonly nodeId: string;
  readonly kind: "capability" | "workflow";
  /** The capabilityId or workflowId the node targets. */
  readonly targetId: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}
