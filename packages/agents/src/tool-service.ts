// packages/agents/src/tool-service.ts
import type {
  AgentToolService,
  ToolCall,
  ToolInvoker,
  ToolResult,
} from "@designflow/sdk";

/**
 * One agent's tool access, for the duration of one decision.
 *
 * Created fresh inside every `decide()` call and thrown away when it returns.
 * That lifetime is the whole design: the call budget lives on the instance, so
 * it cannot be reset by anything the agent does, and an agent that stashed a
 * reference from a previous decision would be holding an object whose budget
 * is already spent rather than a fresh allowance.
 *
 * The agent never sees a registry or a runtime — only `call`. Three things are
 * re-checked on every invocation, none of which depend on the agent
 * cooperating:
 *
 *   the budget          — enforced here, before the tool layer is touched
 *   the allow-list      — passed to the invoker on each call, never bound once
 *   the tool's schemas  — enforced by the invoker
 *
 * ## Why `#private` and not `private`
 *
 * TypeScript's `private` is a compile-time convention. At runtime the fields
 * are ordinary enumerable properties, so an agent could read
 * `Object.keys(context.tools)`, find `invoker`, and call it directly with any
 * allow-list it liked — bypassing both the permission check and the budget
 * completely. That is not a hypothetical: it was a real hole here, and a
 * prompt-injected model is precisely the caller that would find it.
 *
 * `#` fields are enforced by the language. They are absent from `Object.keys`,
 * from `getOwnPropertyNames`, from `JSON.stringify` and from the prototype
 * chain, and there is no reflection that reaches them. The instance is frozen
 * as well, so `call` itself cannot be swapped for something that skips the
 * counter.
 */

/** How many tools one decision may call before the budget refuses. */
export const DEFAULT_MAX_TOOL_CALLS_PER_DECISION = 8;

export interface AgentScopedToolServiceOptions {
  readonly invoker: ToolInvoker;
  /** Permitted *and* installed. Narrowed by the runtime before we get here. */
  readonly allowedTools: readonly string[];
  readonly maxCalls: number;
  readonly agentId: string;
  readonly workerId: string;
  readonly signal?: AbortSignal | undefined;
  /**
   * Reports every completed call to the runtime, for tracing.
   *
   * Given the outcome rather than the call: the tool id, how long it took and
   * whether it worked. Never the input or the output — a tracing hook that
   * could see payloads would be the easiest place in the system to leak one.
   */
  readonly onCall?: ((observed: ObservedToolCall) => void) | undefined;
}

/** What the runtime learns about a call it did not make itself. */
export interface ObservedToolCall {
  readonly toolId: string;
  readonly durationMs: number;
  readonly status: "success" | "failure";
  readonly errorCode?: string | undefined;
}

export class AgentScopedToolService implements AgentToolService {
  readonly #invoker: ToolInvoker;
  readonly #allowedTools: readonly string[];
  readonly #maxCalls: number;
  readonly #agentId: string;
  readonly #workerId: string;
  readonly #signal: AbortSignal | undefined;
  readonly #onCall: ((observed: ObservedToolCall) => void) | undefined;

  #used = 0;

  public constructor(options: AgentScopedToolServiceOptions) {
    this.#invoker = options.invoker;
    this.#allowedTools = [...options.allowedTools];
    this.#maxCalls = options.maxCalls;
    this.#agentId = options.agentId;
    this.#workerId = options.workerId;
    this.#signal = options.signal;
    this.#onCall = options.onCall;

    // Frozen so `call` cannot be replaced with one that skips the counter.
    Object.freeze(this);
  }

  /** How many calls this decision has actually spent. */
  public get callCount(): number {
    return this.#used;
  }

  public call = async (call: ToolCall): Promise<ToolResult> => {
    // Counted before anything else, including validity. A malformed call is
    // still a call, and not counting it would leave a budget that an agent
    // could exhaust the runtime with by sending rubbish.
    //
    // Incremented synchronously, before the first `await`. JavaScript runs
    // this whole prefix without interleaving, so there is no window between
    // reading the counter and spending it for a concurrent call to slip
    // through — `Promise.all` of fifty calls spends fifty, and only the first
    // `maxCalls` of them reach a tool.
    this.#used += 1;

    if (this.#used > this.#maxCalls) {
      // A failure result rather than a throw. An agent that hits its budget
      // should still be able to return a decision — usually a clarification —
      // and an exception mid-`decide` would leave it with no decision at all.
      const refused: ToolResult = {
        type: "failure",
        callId: idOf(call),
        toolId: toolIdOf(call),
        code: "ERR_AGENT_TOOL_BUDGET_EXCEEDED",
        message: "This worker asked for too much information at once.",
        retryable: false,
        durationMs: 0,
      };

      // Observed like any other outcome. A trace showing eight calls and then
      // silence would look like an agent that stopped asking, rather than one
      // that was stopped.
      this.#observe(refused);
      return refused;
    }

    const result = await this.#invoker.invoke({
      call,
      // Sent per call rather than configured once, so the enforcing layer is
      // told what is permitted each time and never trusts an earlier scope.
      allowedTools: this.#allowedTools,
      agentId: this.#agentId,
      workerId: this.#workerId,
      ...(this.#signal !== undefined ? { signal: this.#signal } : {}),
    });

    this.#observe(result);
    return result;
  };

  /** Reporting must never be able to fail the call it is reporting on. */
  #observe(result: ToolResult): void {
    try {
      this.#onCall?.({
        toolId: result.toolId,
        durationMs: result.durationMs,
        status: result.type === "success" ? "success" : "failure",
        ...(result.type === "failure" ? { errorCode: result.code } : {}),
      });
    } catch {
      // Deliberately swallowed, for the same reason every other observation
      // site here swallows: a broken observer must not break a decision.
    }
  }
}

/**
 * A service for an agent with no tools.
 *
 * Every call fails as unpermitted. Used when an agent was granted nothing or
 * no tool layer is installed, so `AgentContext.tools` is always present and an
 * agent never has to null-check the port it was handed.
 */
export const EMPTY_TOOL_SERVICE: AgentToolService = Object.freeze({
  call: (call: ToolCall): Promise<ToolResult> =>
    Promise.resolve({
      type: "failure",
      callId: idOf(call),
      toolId: toolIdOf(call),
      code: "ERR_TOOL_NOT_ALLOWED",
      message: "This worker may not use that tool.",
      retryable: false,
      durationMs: 0,
    }),
});

/**
 * `callId` and `toolId` are `.min(1)` on the result schema, so a malformed
 * call still needs something there. Substituted rather than rejected: the
 * budget and permission answers are the same whatever the call said.
 */
function idOf(call: ToolCall): string {
  return typeof call?.id === "string" && call.id.length > 0 ? call.id : "unknown";
}

function toolIdOf(call: ToolCall): string {
  return typeof call?.toolId === "string" && call.toolId.length > 0
    ? call.toolId
    : "unknown";
}
