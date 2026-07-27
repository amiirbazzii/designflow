import { DesignFlowError } from "@designflow/sdk";

export class ExecutionNotFoundError extends DesignFlowError {
  public constructor(
    executionId: string,
    metadata?: Record<string, unknown>,
  ) {
    super(
      "ERR_EXECUTION_NOT_FOUND",
      `No execution found: ${executionId}`,
      { ...metadata, executionId },
    );
    this.name = "ExecutionNotFoundError";
    Object.setPrototypeOf(this, ExecutionNotFoundError.prototype);
  }
}
