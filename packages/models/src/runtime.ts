// packages/models/src/runtime.ts
import {
  DesignFlowError,
  modelResponseSchema,
  modelResultSchema,
  type Logger,
  type ModelInvocationRequest,
  type ModelInvoker,
  type ModelProvider,
  type ModelProviderContext,
  type ModelRequest,
  type ModelResult,
} from "@designflow/sdk";
import type { InMemoryModelProfileRegistry } from "./profile-registry";
import type { InMemoryModelProviderRegistry } from "./provider-registry";
import {
  ModelRequestInvalidError,
  PROVIDER_THROWABLE_CODES,
  type ModelErrorCode,
} from "./errors";

/**
 * The boundary a model call has to cross.
 *
 * The same shape `ToolRuntime` enforces for tools, one layer up:
 *
 *   1. the request is well-formed          — else throw; there is no id to fail on
 *   2. the profile resolves                — else a failure result, not a throw
 *   3. the provider resolves                — else a failure result
 *   4. the wire request is built and parsed — from the profile, never from the caller
 *   5. execution races a composed abort     — parent cancellation or timeout
 *   6. the response envelope is validated   — the provider answered in a shape we recognise
 *   7. thrown errors are normalised         — a known code passes through, anything else is generic
 *   8. the result itself is validated       — an internal invariant, not a provider's fault
 *
 * Steps 2 and 3 return failures rather than throw, unlike the malformed-call
 * case in step 1 — an unresolved profile or provider is information an agent
 * should be able to decide with (usually: decline, or fall back to whatever
 * it did before models existed), the same reasoning `ERR_TOOL_NOT_FOUND` is a
 * returned failure rather than a thrown one.
 *
 * What this deliberately does not do: execute a workflow, invoke a
 * capability, call a tool, touch a repository, persist anything, or retry.
 * Provider-level fallback models are the one exception, and only because a
 * human wrote them into the profile — the runtime never substitutes a model
 * on its own initiative.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Applied when a profile declares no timeout of its own. */
export const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

/** Internal sentinel: the composed signal fired before `generate` resolved. */
class AbortedDuringGeneration extends Error {}

export interface ModelRuntimeOptions {
  readonly profiles: InMemoryModelProfileRegistry;
  readonly providers: InMemoryModelProviderRegistry;
  /** Ambient facts every provider sees. Per-call data travels on the request. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly logger?: Logger | undefined;
  readonly defaultTimeoutMs?: number | undefined;
}

export class ModelRuntime implements ModelInvoker {
  private readonly profiles: InMemoryModelProfileRegistry;
  private readonly providers: InMemoryModelProviderRegistry;
  private readonly metadata: Readonly<Record<string, unknown>>;
  private readonly logger: Logger;
  private readonly defaultTimeoutMs: number;

  public constructor(options: ModelRuntimeOptions) {
    this.profiles = options.profiles;
    this.providers = options.providers;
    // Frozen, not just typed `Readonly` — the same object is handed to every
    // provider on every call, so an unfrozen one is a channel a hostile
    // provider adapter could use to leave state behind for the next call.
    this.metadata = Object.freeze({ ...options.metadata });
    this.logger = options.logger ?? silentLogger;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  }

  public installedProfileIds(): readonly string[] {
    return this.profiles.ids();
  }

  public async generate(request: ModelInvocationRequest): Promise<ModelResult> {
    const validated = this.parseRequest(request);
    const startedAt = performance.now();

    const fail = (code: string, message: string, retryable = false): ModelResult =>
      this.validateResult({
        type: "failure",
        requestId: validated.requestId,
        code,
        message,
        retryable,
        durationMs: elapsed(startedAt),
      });

    const profile = this.profiles.get(validated.profileId);
    if (profile === undefined) {
      return fail("ERR_MODEL_PROFILE_NOT_FOUND", "That model profile is not configured.");
    }

    const provider = this.providers.get(profile.providerId);
    if (provider === undefined) {
      return fail(
        "ERR_MODEL_PROVIDER_NOT_FOUND",
        "The provider this model profile names is not installed.",
      );
    }

    // Built from the profile — never from the caller. `providerId`, `model`,
    // `timeoutMs`, `fallbackModels` and `providerRouting` are all
    // security-relevant policy, and the agent-facing request has no field for
    // any of them; this is the one place they are read, and they are read
    // from the profile the registry resolved, not from anything the caller
    // supplied alongside `profileId`.
    const wireRequest: ModelRequest = {
      requestId: validated.requestId,
      profileId: profile.id,
      model: profile.model,
      messages: [...validated.messages],
      responseSchema: validated.responseSchema,
      temperature: validated.temperature ?? profile.temperature,
      maxOutputTokens: validated.maxOutputTokens ?? profile.maxOutputTokens,
      fallbackModels: profile.fallbackModels,
      ...(profile.providerRouting !== undefined
        ? { providerRouting: profile.providerRouting }
        : {}),
    };

    return this.execute(provider, wireRequest, validated, profile.timeoutMs, startedAt, fail);
  }

  /**
   * Runs the provider against one composed abort signal.
   *
   * Composed rather than passed through, for the identical reason
   * `ToolRuntime.execute` composes one: two independent reasons to stop — the
   * caller cancelled, or the call ran too long — collapsed into a signal a
   * provider only ever has to watch once.
   */
  private async execute(
    provider: ModelProvider,
    wireRequest: ModelRequest,
    invocation: ModelInvocationRequest,
    profileTimeoutMs: number | undefined,
    startedAt: number,
    fail: (code: string, message: string, retryable?: boolean) => ModelResult,
  ): Promise<ModelResult> {
    const timeoutMs = profileTimeoutMs ?? this.defaultTimeoutMs;
    const parent = invocation.signal;

    const controller = new AbortController();
    let stopped: "timeout" | "aborted" | null = null;

    const onParentAbort = (): void => {
      stopped = "aborted";
      controller.abort();
    };

    if (parent?.aborted === true) {
      // Already cancelled before we started. Reported rather than swallowed:
      // a caller that aborted must not receive something that looks like the
      // model declined to answer.
      return fail("ERR_MODEL_ABORTED", "The request was cancelled.");
    }

    parent?.addEventListener("abort", onParentAbort, { once: true });

    const timer = setTimeout(() => {
      stopped = "timeout";
      controller.abort();
    }, timeoutMs);

    const context: ModelProviderContext = {
      signal: controller.signal,
      logger: this.logger,
      metadata: this.metadata,
    };

    try {
      const response = await Promise.race([
        provider.generate(wireRequest, context),
        rejectWhenAborted(controller.signal),
      ]);

      const parsedResponse = modelResponseSchema.safeParse(response);
      if (!parsedResponse.success) {
        return fail(
          "ERR_MODEL_RESPONSE_INVALID",
          "The provider returned something unusable.",
        );
      }

      return this.validateResult({
        type: "success",
        requestId: wireRequest.requestId,
        providerId: parsedResponse.data.providerId,
        model: parsedResponse.data.model,
        output: parsedResponse.data.output,
        ...(parsedResponse.data.usage !== undefined
          ? { usage: parsedResponse.data.usage }
          : {}),
        durationMs: elapsed(startedAt),
      });
    } catch (error) {
      if (stopped === "timeout") {
        // Retryable: a timeout says nothing about whether the call was valid.
        return fail("ERR_MODEL_TIMEOUT", "The model took too long to answer.", true);
      }

      if (stopped === "aborted" || error instanceof AbortedDuringGeneration) {
        return fail("ERR_MODEL_ABORTED", "The request was cancelled.");
      }

      return this.normalizeThrown(error, fail);
    } finally {
      // Both, always. The timer would otherwise hold the process open for the
      // rest of its timeout, and the parent listener would accumulate one
      // entry per call on a signal that outlives every one of them.
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    }
  }

  /**
   * Turns whatever a provider threw into a safe, coded failure.
   *
   * A provider may throw a plain `DesignFlowError` carrying one of a fixed
   * set of codes — `ERR_MODEL_AUTHENTICATION`, `ERR_MODEL_RATE_LIMITED`, and
   * so on — and that code is passed through, because the provider is the only
   * layer that actually saw the HTTP status or the vendor's error shape.
   * Anything else — a generic exception, an error with a code this runtime
   * does not recognise — is collapsed to `ERR_MODEL_PROVIDER_FAILED` with a
   * sanitised message, so a provider adapter cannot mint an internal code by
   * accident and cannot leak a stack, a header or a raw response body through
   * an uncurated error message.
   */
  private normalizeThrown(
    error: unknown,
    fail: (code: string, message: string, retryable?: boolean) => ModelResult,
  ): ModelResult {
    if (error instanceof DesignFlowError && isProviderThrowable(error.code)) {
      return fail(error.code, sanitize(error.message), retryableByDefault(error.code));
    }

    return fail("ERR_MODEL_PROVIDER_FAILED", sanitize(error), true);
  }

  private parseRequest(request: ModelInvocationRequest): ModelInvocationRequest {
    const issues: string[] = [];

    if (typeof request.requestId !== "string" || request.requestId.length === 0) {
      issues.push("requestId: required");
    }
    if (typeof request.profileId !== "string" || request.profileId.length === 0) {
      issues.push("profileId: required");
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      issues.push("messages: at least one message is required");
    }
    if (
      typeof request.responseSchema !== "object" ||
      request.responseSchema === null ||
      Array.isArray(request.responseSchema)
    ) {
      issues.push("responseSchema: required");
    }

    if (issues.length > 0) {
      throw new ModelRequestInvalidError(issues);
    }

    return request;
  }

  private validateResult(result: unknown): ModelResult {
    const parsed = modelResultSchema.safeParse(result);

    if (!parsed.success) {
      // An internal invariant — everything placed on `result` above is
      // derived by this runtime, never taken from a provider unparsed — so
      // this throws rather than degrading into a failure result a caller
      // would try to reason about.
      throw new DesignFlowError(
        "ERR_MODEL_RESPONSE_INVALID",
        `The runtime produced an invalid model result: ${describe(parsed.error)}`,
      );
    }

    return parsed.data;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function isProviderThrowable(code: string): code is ModelErrorCode {
  return (PROVIDER_THROWABLE_CODES as readonly string[]).includes(code);
}

function retryableByDefault(code: ModelErrorCode): boolean {
  return code === "ERR_MODEL_RATE_LIMITED" || code === "ERR_MODEL_UNAVAILABLE";
}

function elapsed(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt);
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new AbortedDuringGeneration()), {
      once: true,
    });
  });
}

/**
 * A thrown value as one safe line.
 *
 * The same discipline `@designflow/tools` applies: message only, never a
 * stack, never a `cause`, collapsed and truncated so nothing a provider threw
 * can forge structure in whatever renders it.
 */
function sanitize(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const collapsed = raw.replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) return "The model call failed without an explanation.";

  return collapsed.length > 200 ? `${collapsed.slice(0, 200)}…` : collapsed;
}

function describe(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
