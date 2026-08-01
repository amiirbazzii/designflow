// packages/tools/src/runtime.ts
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  NOOP_AGENT_OBSERVER,
  shapeOf,
  toolCallSchema,
  toolResultSchema,
  type AgentObserver,
  type Logger,
  type Tool,
  type ToolCall,
  type ToolContext,
  type ToolInvocationRequest,
  type ToolInvoker,
  type ToolResult,
} from "@designflow/sdk";

import type { ZodError } from "zod";
import type { InMemoryToolRegistry } from "./registry";
import { ToolCallInvalidError, ToolResultInvalidError } from "./errors";

/**
 * The boundary a tool call has to cross.
 *
 * Nine checks, in this order, and the order is part of the design:
 *
 *   1. the call parses                    — else throw; there is no id to fail on
 *   2. the tool is *permitted*            — before we admit whether it exists
 *   3. the tool is installed
 *   4. the input parses against the tool's own schema
 *   5. a restricted context is built      — signal, logger, metadata; nothing else
 *   6. execution races a composed abort   — parent cancellation or timeout
 *   7. the output parses against the tool's own schema
 *   8. thrown errors are sanitised
 *   9. the result itself parses
 *
 * Step 2 before step 3 is a deliberate information-hiding choice. If an
 * unpermitted call reported "no such tool" for an uninstalled id and "not
 * allowed" for an installed one, the difference would let a caller enumerate
 * what is installed by probing. An agent that may not call a tool learns
 * nothing about whether it exists.
 *
 * Step 7 exists because a tool's output is untrusted in exactly the way an
 * agent's decision is. A tool reads a file, calls a library, or one day
 * answers over a network; whatever comes back is data from outside this
 * process, and handing it to a decision-maker unparsed would make the tool's
 * *implementation* the thing that defines its contract.
 *
 * What this deliberately does not do: execute a workflow, invoke a capability,
 * touch a repository, persist anything, or retry. There is no retry loop and
 * no back-off — a tool that failed failed, and whether to try again is a
 * decision, which means it belongs to the agent and its budget.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Internal sentinel: the composed signal fired before `execute` resolved. */
class AbortedDuringExecution extends Error {}

export interface ToolRuntimeOptions {
  readonly registry: InMemoryToolRegistry;
  /** Ambient facts every tool sees. Per-call data travels on the input. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly logger?: Logger | undefined;
  readonly observer?: AgentObserver | undefined;
  /** Applied when a tool's manifest declares no timeout of its own. */
  readonly defaultTimeoutMs?: number | undefined;
}

export class ToolRuntime implements ToolInvoker {
  private readonly registry: InMemoryToolRegistry;
  private readonly metadata: Readonly<Record<string, unknown>>;
  private readonly logger: Logger;
  private readonly observer: AgentObserver;
  private readonly defaultTimeoutMs: number;

  public constructor(options: ToolRuntimeOptions) {
    this.registry = options.registry;
    // Frozen, not just typed `Readonly`. The same object is handed to every
    // tool on every call, so an unfrozen one is a channel a hostile tool could
    // use to leave state behind for the next.
    this.metadata = Object.freeze({ ...options.metadata });
    this.logger = options.logger ?? silentLogger;
    this.observer = options.observer ?? NOOP_AGENT_OBSERVER;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  }

  public installedToolIds(): readonly string[] {
    return this.registry.ids();
  }

  public async invoke(request: ToolInvocationRequest): Promise<ToolResult> {
    const call = this.parseCall(request.call);
    const startedAt = performance.now();

    this.emit({
      type: "tool.call.started",
      callId: call.id,
      toolId: call.toolId,
      ...(request.agentId !== undefined ? { agentId: request.agentId } : {}),
      ...(request.workerId !== undefined ? { workerId: request.workerId } : {}),
      inputKeys: [...shapeOf(call.input)],
    });

    const result = await this.run(call, request, startedAt);

    if (result.type === "success") {
      this.emit({
        type: "tool.call.completed",
        callId: result.callId,
        toolId: result.toolId,
        durationMs: result.durationMs,
        outputKeys: [...shapeOf(result.output)],
      });
    } else {
      this.emit({
        type: "tool.call.failed",
        callId: result.callId,
        toolId: result.toolId,
        code: result.code,
        message: result.message,
        retryable: result.retryable,
        durationMs: result.durationMs,
      });
    }

    return result;
  }

  private async run(
    call: ToolCall,
    request: ToolInvocationRequest,
    startedAt: number,
  ): Promise<ToolResult> {
    const fail = (
      code: string,
      message: string,
      retryable = false,
    ): ToolResult =>
      this.validate({
        type: "failure",
        callId: call.id,
        toolId: call.toolId,
        code,
        message,
        retryable,
        durationMs: elapsed(startedAt),
      });

    // Permission before existence. See the note above `ToolRuntime`.
    if (!request.allowedTools.includes(call.toolId)) {
      return fail("ERR_TOOL_NOT_ALLOWED", "This worker may not use that tool.");
    }

    const tool = this.registry.get(call.toolId);
    if (tool === undefined) {
      return fail("ERR_TOOL_NOT_FOUND", "That tool is not installed.");
    }

    const parsedInput = tool.inputSchema.safeParse(call.input);
    if (!parsedInput.success) {
      return fail(
        "ERR_TOOL_INPUT_INVALID",
        `The tool was called with unusable input: ${describe(parsedInput.error).join("; ")}`,
      );
    }

    return this.execute(tool, parsedInput.data, call, request, startedAt, fail);
  }

  /**
   * Runs the tool against one composed abort signal.
   *
   * Composed rather than passed through, because there are two independent
   * reasons to stop — the caller cancelled, or the tool ran too long — and a
   * tool should only ever have to watch one signal.
   *
   * The race matters as much as the signal. A well-behaved tool observes
   * `context.signal` and returns; a badly-behaved one ignores it entirely, and
   * without racing, its promise would keep the decision open forever with the
   * timeout having fired into the void. Racing means the timeout is enforced
   * on the *runtime*, not delegated to the tool's good manners.
   */
  private async execute(
    tool: Tool,
    input: unknown,
    call: ToolCall,
    request: ToolInvocationRequest,
    startedAt: number,
    fail: (code: string, message: string, retryable?: boolean) => ToolResult,
  ): Promise<ToolResult> {
    const timeoutMs = tool.manifest.timeoutMs ?? this.defaultTimeoutMs;
    const parent = request.signal;

    const controller = new AbortController();
    let stopped: "timeout" | "aborted" | null = null;

    const onParentAbort = (): void => {
      stopped = "aborted";
      controller.abort();
    };

    if (parent?.aborted === true) {
      // Already cancelled before we started. Reported rather than swallowed:
      // a caller that aborted must not receive something that looks like a
      // tool having declined to answer.
      return fail("ERR_TOOL_ABORTED", "The request was cancelled.");
    }

    parent?.addEventListener("abort", onParentAbort, { once: true });

    const timer = setTimeout(() => {
      stopped = "timeout";
      controller.abort();
    }, timeoutMs);

    const context: ToolContext = {
      signal: controller.signal,
      logger: this.logger,
      metadata: this.metadata,
    };

    try {
      const output = await Promise.race([
        tool.execute(input, context),
        rejectWhenAborted(controller.signal),
      ]);

      const parsedOutput = tool.outputSchema.safeParse(output);
      if (!parsedOutput.success) {
        return fail(
          "ERR_TOOL_OUTPUT_INVALID",
          `The tool returned something unusable: ${describe(parsedOutput.error).join("; ")}`,
        );
      }

      return this.validate({
        type: "success",
        callId: call.id,
        toolId: call.toolId,
        output: parsedOutput.data,
        durationMs: elapsed(startedAt),
      });
    } catch (error) {
      if (stopped === "timeout") {
        // Retryable: a timeout says nothing about whether the call was valid.
        return fail("ERR_TOOL_TIMEOUT", "The tool took too long to answer.", true);
      }

      if (stopped === "aborted" || error instanceof AbortedDuringExecution) {
        return fail("ERR_TOOL_ABORTED", "The request was cancelled.");
      }

      return fail("ERR_TOOL_EXECUTION_FAILED", sanitize(error));
    } finally {
      // Both, always. The timer would otherwise hold the process open for the
      // rest of its timeout, and the parent listener would accumulate one
      // entry per call on a signal that outlives every one of them.
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    }
  }

  private parseCall(call: ToolCall): ToolCall {
    const result = toolCallSchema.safeParse(call);

    if (!result.success) {
      throw new ToolCallInvalidError(describe(result.error));
    }

    return result.data;
  }

  private validate(result: unknown): ToolResult {
    const parsed = toolResultSchema.safeParse(result);

    if (!parsed.success) {
      const toolId =
        typeof result === "object" && result !== null && "toolId" in result
          ? String((result as { toolId: unknown }).toolId)
          : "unknown";

      throw new ToolResultInvalidError(toolId, describe(parsed.error));
    }

    return parsed.data;
  }

  /** Observation must never be able to break the path it is watching. */
  private emit(observation: Parameters<AgentObserver["observe"]>[0]): void {
    try {
      this.observer.observe(observation);
    } catch {
      // Deliberately swallowed. An observer that throws is a bug in the
      // observer, and failing a tool call over it would make adding
      // observability riskier than going without.
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function elapsed(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new AbortedDuringExecution()), {
      once: true,
    });
  });
}

/**
 * A thrown value as one safe line.
 *
 * Message only — never `stack`, never `cause`, never the error object. A stack
 * carries absolute paths and internal module layout, and an infrastructure
 * error's `cause` chain is where a connection string or a token is most likely
 * to surface. Whitespace is collapsed so a multi-line message cannot forge
 * structure in whatever renders it, and the whole thing is truncated.
 */
function sanitize(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const collapsed = raw.replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) return "The tool failed without an explanation.";

  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed;
}

function describe(error: ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}
