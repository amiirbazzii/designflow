import { DesignFlowError } from "@designflow/sdk";

export class ImplementationError extends DesignFlowError {
  public constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(code, message, metadata);
    this.name = "ImplementationError";
  }
}
