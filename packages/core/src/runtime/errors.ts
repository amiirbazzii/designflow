import { DesignFlowError } from "@designflow/sdk";

export class CapabilityExecutionError extends DesignFlowError {
  public constructor(
    message: string,
    metadata?: {
      capabilityId?: string;
      attempt?: number;
      cause?: unknown;
    },
  ) {
    super("ERR_CAPABILITY_EXECUTION", message, {
      ...metadata,
      capabilityId: metadata?.capabilityId,
      attempt: metadata?.attempt,
      cause: metadata?.cause instanceof Error
        ? metadata.cause.message
        : metadata?.cause,
    });
    this.name = "CapabilityExecutionError";
    Object.setPrototypeOf(this, CapabilityExecutionError.prototype);
  }
}