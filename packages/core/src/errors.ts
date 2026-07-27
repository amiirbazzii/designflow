// packages/core/src/errors.ts
import { DesignFlowError } from "@designflow/sdk";

export class WorkflowCompilationError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_WORKFLOW_COMPILATION", message, metadata);
    this.name = "WorkflowCompilationError";
    Object.setPrototypeOf(this, WorkflowCompilationError.prototype);
  }
}

export class CapabilityNotFoundError extends DesignFlowError {
  public constructor(
    capabilityId: string,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_CAPABILITY_NOT_FOUND",
      `Capability not found: ${capabilityId}`,
      { ...metadata, capabilityId },
    );
    this.name = "CapabilityNotFoundError";
    Object.setPrototypeOf(this, CapabilityNotFoundError.prototype);
  }
}

export class ExecutionError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_EXECUTION_FAILED", message, metadata);
    this.name = "ExecutionError";
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

export class ExecutionRepositoryError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_EXECUTION_REPOSITORY", message, metadata);
    this.name = "ExecutionRepositoryError";
    Object.setPrototypeOf(this, ExecutionRepositoryError.prototype);
  }
}

export class ExecutionEventError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_EXECUTION_EVENT", message, metadata);
    this.name = "ExecutionEventError";
    Object.setPrototypeOf(this, ExecutionEventError.prototype);
  }
}

export class PolicyViolationError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_POLICY_VIOLATION", message, metadata);
    this.name = "PolicyViolationError";
    Object.setPrototypeOf(this, PolicyViolationError.prototype);
  }
}

export class ApprovalError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_APPROVAL", message, metadata);
    this.name = "ApprovalError";
    Object.setPrototypeOf(this, ApprovalError.prototype);
  }
}

export class WorkflowCompositionError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_WORKFLOW_COMPOSITION", message, metadata);
    this.name = "WorkflowCompositionError";
    Object.setPrototypeOf(this, WorkflowCompositionError.prototype);
  }
}

export class WorkflowCompositionCycleError extends DesignFlowError {
  public readonly compositionPath: readonly string[];

  public constructor(
    workflowId: string,
    compositionPath: readonly string[],
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_WORKFLOW_COMPOSITION_CYCLE",
      `Workflow composition cycle detected: ${[...compositionPath].join(" -> ")}`,
      { ...metadata, workflowId, compositionPath: [...compositionPath] },
    );
    this.name = "WorkflowCompositionCycleError";
    this.compositionPath = [...compositionPath];
    Object.setPrototypeOf(this, WorkflowCompositionCycleError.prototype);
  }
}

export class ArtifactNotFoundError extends DesignFlowError {
  public constructor(
    artifactId: string,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_ARTIFACT_NOT_FOUND",
      `Artifact not found: ${artifactId}`,
      { ...metadata, artifactId },
    );
    this.name = "ArtifactNotFoundError";
    Object.setPrototypeOf(this, ArtifactNotFoundError.prototype);
  }
}

export class ArtifactReconciliationError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_ARTIFACT_RECONCILIATION_FAILED", message, metadata);
    this.name = "ArtifactReconciliationError";
    Object.setPrototypeOf(this, ArtifactReconciliationError.prototype);
  }
}

export class ArtifactMaterializationError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_ARTIFACT_MATERIALIZATION", message, metadata);
    this.name = "ArtifactMaterializationError";
    Object.setPrototypeOf(this, ArtifactMaterializationError.prototype);
  }
}

export class ExecutionPlanningError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super("ERR_EXECUTION_PLANNING", message, metadata);
    this.name = "ExecutionPlanningError";
    Object.setPrototypeOf(this, ExecutionPlanningError.prototype);
  }
}

export class ArtifactVersionNotFoundError extends DesignFlowError {
  public constructor(
    artifactId: string,
    version: number,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_ARTIFACT_VERSION_NOT_FOUND",
      `Artifact version not found: ${artifactId}@${version}`,
      { ...metadata, artifactId, version },
    );
    this.name = "ArtifactVersionNotFoundError";
    Object.setPrototypeOf(this, ArtifactVersionNotFoundError.prototype);
  }
}

export class ArtifactConflictError extends DesignFlowError {
  public constructor(
    artifactId: string,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_ARTIFACT_EXISTS",
      `Artifact already registered: ${artifactId}`,
      { ...metadata, artifactId },
    );
    this.name = "ArtifactConflictError";
    Object.setPrototypeOf(this, ArtifactConflictError.prototype);
  }
}

export class ArtifactCycleError extends DesignFlowError {
  public readonly cyclePath: readonly string[];

  public constructor(
    cyclePath: readonly string[],
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_ARTIFACT_CYCLE",
      `Artifact relation cycle detected: ${[...cyclePath].join(" -> ")}`,
      { ...metadata, cyclePath: [...cyclePath] },
    );
    this.name = "ArtifactCycleError";
    this.cyclePath = [...cyclePath];
    Object.setPrototypeOf(this, ArtifactCycleError.prototype);
  }
}

export class WorkflowResolverNotConfiguredError extends DesignFlowError {
  public constructor(
    workflowId: string,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_WORKFLOW_RESOLVER_NOT_CONFIGURED",
      `No WorkflowExecutionResolver configured; cannot execute child workflow: ${workflowId}`,
      { ...metadata, workflowId },
    );
    this.name = "WorkflowResolverNotConfiguredError";
    Object.setPrototypeOf(this, WorkflowResolverNotConfiguredError.prototype);
  }
}