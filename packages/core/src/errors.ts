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
