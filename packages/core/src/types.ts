import type {
  Capability,
  CapabilityNode,
  WorkflowDefinition,
  WorkflowMetadata,
  ArtifactRef,
} from "@designflow/sdk";

// ── Compiled Workflow ──────────────────────────────────────────────

export interface CompiledNode {
  readonly node: CapabilityNode;
  readonly capability: Capability<unknown, unknown>;
  readonly order: number;
}

export interface CompiledWorkflow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly metadata: WorkflowMetadata;
  readonly nodes: readonly CompiledNode[];
}

// ── Lifecycle Types ────────────────────────────────────────────────

export interface ExecutionStep {
  readonly nodeId: string;
  readonly capabilityId: string;
  readonly label: string | undefined;
  readonly inputMap: Readonly<Record<string, unknown>>;
  readonly dependsOn: readonly string[];
}

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

export interface ExecutionResult {
  readonly workflowId: string;
  readonly success: boolean;
  readonly artifacts: readonly ArtifactRef[];
  readonly completedSteps: readonly string[];
  readonly failedStep: string | undefined;
  readonly error: unknown;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface ValidationIssue {
  readonly nodeId: string;
  readonly capabilityId: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}
