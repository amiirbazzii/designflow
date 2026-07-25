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
