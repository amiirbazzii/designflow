// packages/tools/src/errors.ts
import { DesignFlowError } from "@designflow/sdk";

/**
 * Tool failures, each with a stable code.
 *
 * Two shapes of failure, and the difference is deliberate:
 *
 *   **thrown**   — the caller misused the runtime. A malformed `ToolCall` has
 *                  no valid `callId`, so there is nothing to put a failure
 *                  result *on*; it is a programming error, and it throws.
 *
 *   **returned** — the tool call itself failed. Not allowed, not installed,
 *                  bad input, bad output, timed out, aborted, threw. These
 *                  come back as `{type: "failure", code}` rather than
 *                  throwing, because a tool failure is information an agent
 *                  should be able to *decide with* — an agent whose tool call
 *                  exploded mid-`decide` would produce no decision at all,
 *                  when the right answer is usually to ask a question instead.
 *
 * Both use these codes. `TOOL_ERROR_CODES` is the enumeration the CLI's
 * user-facing error table is checked against, so a code added here without a
 * message there fails a test rather than reaching a person as raw text.
 */

export const TOOL_ERROR_CODES = [
  "ERR_TOOL_NOT_FOUND",
  "ERR_TOOL_ALREADY_REGISTERED",
  "ERR_TOOL_CALL_INVALID",
  "ERR_TOOL_INPUT_INVALID",
  "ERR_TOOL_OUTPUT_INVALID",
  "ERR_TOOL_NOT_ALLOWED",
  "ERR_TOOL_TIMEOUT",
  "ERR_TOOL_EXECUTION_FAILED",
  "ERR_TOOL_ABORTED",
  "ERR_TOOL_RESULT_INVALID",
] as const;

export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export class ToolNotFoundError extends DesignFlowError {
  public constructor(toolId: string, available: readonly string[]) {
    super("ERR_TOOL_NOT_FOUND", `No such tool: ${toolId}`, {
      toolId,
      available: [...available],
    });
    this.name = "ToolNotFoundError";
    Object.setPrototypeOf(this, ToolNotFoundError.prototype);
  }
}

export class DuplicateToolError extends DesignFlowError {
  public constructor(toolId: string) {
    super(
      "ERR_TOOL_ALREADY_REGISTERED",
      `A tool is already registered as: ${toolId}`,
      { toolId },
    );
    this.name = "DuplicateToolError";
    Object.setPrototypeOf(this, DuplicateToolError.prototype);
  }
}

/**
 * The call handed to the runtime was not a call.
 *
 * The one tool failure that throws. Without a valid `id` there is no result to
 * return it on, and inventing one would mean a caller correlating results to
 * calls by an id the runtime made up.
 */
export class ToolCallInvalidError extends DesignFlowError {
  public constructor(issues: readonly string[]) {
    super("ERR_TOOL_CALL_INVALID", `Invalid tool call: ${issues.join("; ")}`, {
      issues: [...issues],
    });
    this.name = "ToolCallInvalidError";
    Object.setPrototypeOf(this, ToolCallInvalidError.prototype);
  }
}

/**
 * The runtime built a result that does not satisfy `toolResultSchema`.
 *
 * An internal invariant, not something a tool can cause. It throws because a
 * malformed result cannot be returned as a result, and returning it anyway
 * would put an unvalidated object in front of an agent — the exact thing the
 * output schema exists to prevent.
 */
export class ToolResultInvalidError extends DesignFlowError {
  public constructor(toolId: string, issues: readonly string[]) {
    super(
      "ERR_TOOL_RESULT_INVALID",
      `The runtime produced an invalid result for tool ${toolId}: ${issues.join("; ")}`,
      { toolId, issues: [...issues] },
    );
    this.name = "ToolResultInvalidError";
    Object.setPrototypeOf(this, ToolResultInvalidError.prototype);
  }
}
