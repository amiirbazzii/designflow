// packages/capabilities/figma-mcp/src/errors.ts
import { DesignFlowError } from "@designflow/sdk";

export const FIGMA_MCP_ERROR_CODES = [
  "ERR_FIGMA_SOURCE_INVALID",
  "ERR_FIGMA_MCP_UNSUPPORTED_OPERATION",
  "ERR_FIGMA_FILE_NOT_FOUND",
  "ERR_FIGMA_NODE_NOT_FOUND",
  "ERR_FIGMA_FRAME_AMBIGUOUS",
  "ERR_FIGMA_FRAME_NOT_FOUND",
  "ERR_FIGMA_SCREENSHOT_INVALID",
] as const;

export type FigmaMcpErrorCode = (typeof FIGMA_MCP_ERROR_CODES)[number];

/** The connected server does not expose the logical operation this call needs. */
export class FigmaMcpUnsupportedOperationError extends DesignFlowError {
  public constructor(operation: string) {
    super(
      "ERR_FIGMA_MCP_UNSUPPORTED_OPERATION",
      `The configured MCP server does not support: ${operation}`,
      { operation },
    );
    this.name = "FigmaMcpUnsupportedOperationError";
    Object.setPrototypeOf(this, FigmaMcpUnsupportedOperationError.prototype);
  }
}

/** A requested frame name/path matched more than one visible node. */
export class FigmaFrameAmbiguousError extends DesignFlowError {
  public constructor(requested: string, candidatePaths: readonly string[]) {
    super(
      "ERR_FIGMA_FRAME_AMBIGUOUS",
      `"${requested}" matches more than one frame: ${candidatePaths.join(", ")}`,
      { requested, candidatePaths: [...candidatePaths] },
    );
    this.name = "FigmaFrameAmbiguousError";
    Object.setPrototypeOf(this, FigmaFrameAmbiguousError.prototype);
  }
}

/** A requested frame name/path, or an explicit node id, matched nothing. */
export class FigmaFrameNotFoundError extends DesignFlowError {
  public constructor(requested: readonly string[]) {
    super(
      "ERR_FIGMA_FRAME_NOT_FOUND",
      `Could not find: ${requested.join(", ")}`,
      { requested: [...requested] },
    );
    this.name = "FigmaFrameNotFoundError";
    Object.setPrototypeOf(this, FigmaFrameNotFoundError.prototype);
  }
}
