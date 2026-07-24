export class DesignFlowError extends Error {
  public readonly code: string;
  public readonly metadata: Record<string, unknown>;

  public constructor(
    code: string,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DesignFlowError";
    this.code = code;
    this.metadata = metadata ?? {};

    Object.setPrototypeOf(this, DesignFlowError.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      metadata: this.metadata,
    };
  }
}