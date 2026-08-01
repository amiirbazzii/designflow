// packages/agents/src/model-service.ts
import type {
  AgentModelRequest,
  AgentModelService,
  ModelInvoker,
  ModelResult,
} from "@designflow/sdk";

/**
 * One agent's model access, for the duration of one decision.
 *
 * The model-shaped twin of `AgentScopedToolService`, and built the same way
 * for the same reasons: created fresh inside every `decide()` call, bound to
 * exactly one profile at construction, and thrown away when the call returns.
 * The budget lives on the instance, so it cannot be reset by anything the
 * agent does and cannot be carried over from a previous decision as spare
 * capacity.
 *
 * `#private` fields and `Object.freeze`, not `private` — see
 * `tool-service.ts`'s note on why. The exploit that motivated it there
 * applies identically here: TypeScript's `private` is compile-time only, and
 * an agent that could read `Object.keys(context.model)` and find `invoker`
 * would be able to call any profile directly, bypassing both the scoping to
 * its own profile and the budget completely.
 */

/** How many model calls one decision may make before the budget refuses. */
export const DEFAULT_MAX_MODEL_CALLS_PER_DECISION = 3;

export interface AgentScopedModelServiceOptions {
  readonly invoker: ModelInvoker;
  /** The agent's own profile — the only one this instance will ever call. */
  readonly profileId: string;
  readonly maxCalls: number;
  readonly agentId: string;
  readonly workerId: string;
  readonly signal?: AbortSignal | undefined;
  /** Fired synchronously, just before the call reaches the model layer. */
  readonly onStart?: ((info: ObservedModelStart) => void) | undefined;
  /** Fired once the call resolves, whichever way. */
  readonly onCall?: ((observed: ObservedModelCall) => void) | undefined;
}

export interface ObservedModelStart {
  readonly requestId: string;
  readonly profileId: string;
}

/**
 * A type intersection rather than `interface ... extends ModelResult`:
 * `ModelResult` is a discriminated union, and an interface can only extend an
 * object type, not a union of them.
 */
export type ObservedModelCall = ModelResult & { readonly profileId: string };

export class AgentScopedModelService implements AgentModelService {
  readonly #invoker: ModelInvoker;
  readonly #profileId: string;
  readonly #maxCalls: number;
  readonly #agentId: string;
  readonly #workerId: string;
  readonly #signal: AbortSignal | undefined;
  readonly #onStart: ((info: ObservedModelStart) => void) | undefined;
  readonly #onCall: ((observed: ObservedModelCall) => void) | undefined;

  #used = 0;

  public constructor(options: AgentScopedModelServiceOptions) {
    this.#invoker = options.invoker;
    this.#profileId = options.profileId;
    this.#maxCalls = options.maxCalls;
    this.#agentId = options.agentId;
    this.#workerId = options.workerId;
    this.#signal = options.signal;
    this.#onStart = options.onStart;
    this.#onCall = options.onCall;

    // Frozen so `generate` cannot be replaced with one that skips the counter.
    Object.freeze(this);
  }

  /** How many calls this decision has actually spent. */
  public get callCount(): number {
    return this.#used;
  }

  public generate = async (request: AgentModelRequest): Promise<ModelResult> => {
    // Counted before anything else, including validity — the same reasoning
    // `AgentScopedToolService` applies: an agent should not be able to spend
    // an unbounded number of attempts by sending requests the schema rejects.
    //
    // Incremented synchronously, before the first `await`, so `Promise.all`
    // of many concurrent calls cannot race past the budget — only the first
    // `maxCalls` of them ever reach `#invoker.generate`.
    this.#used += 1;

    const requestId = crypto.randomUUID();

    if (this.#used > this.#maxCalls) {
      const refused: ModelResult = {
        type: "failure",
        requestId,
        code: "ERR_AGENT_MODEL_BUDGET_EXCEEDED",
        message: "This worker asked its model for too much at once.",
        retryable: false,
        durationMs: 0,
      };

      // Observed like any other outcome — no `onStart` first, since the call
      // never actually reached the model layer.
      this.#observe(refused);
      return refused;
    }

    this.#onStart?.({ requestId, profileId: this.#profileId });

    const result = await this.#invoker.generate({
      requestId,
      profileId: this.#profileId,
      messages: request.messages,
      responseSchema: request.responseSchema,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxOutputTokens !== undefined
        ? { maxOutputTokens: request.maxOutputTokens }
        : {}),
      agentId: this.#agentId,
      workerId: this.#workerId,
      ...(this.#signal !== undefined ? { signal: this.#signal } : {}),
    });

    this.#observe(result);
    return result;
  };

  /** Reporting must never be able to fail the call it is reporting on. */
  #observe(result: ModelResult): void {
    try {
      this.#onCall?.({ ...result, profileId: this.#profileId });
    } catch {
      // Deliberately swallowed, for the same reason every other observation
      // site in this codebase swallows: a broken observer must not break a
      // decision.
    }
  }
}

/**
 * A service for an agent with no model profile.
 *
 * Every call fails with a stable code. Used when an agent's manifest names no
 * `modelProfileId`, or no model layer is installed at all, so
 * `AgentContext.model` is always present and an agent never has to null-check
 * the port it was handed — the same reasoning `EMPTY_TOOL_SERVICE` follows.
 */
export const EMPTY_MODEL_SERVICE: AgentModelService = Object.freeze({
  generate: (): Promise<ModelResult> =>
    Promise.resolve({
      type: "failure",
      requestId: "unconfigured",
      code: "ERR_MODEL_PROFILE_NOT_FOUND",
      message: "This worker has no model configured.",
      retryable: false,
      durationMs: 0,
    }),
});
