// packages/models/src/runtime.test.ts
import { describe, expect, test } from "bun:test";
import {
  DesignFlowError,
  type ModelProvider,
  type ModelProviderContext,
  type ModelRequest,
  type ModelResult,
} from "@designflow/sdk";
import { InMemoryModelProfileRegistry } from "./profile-registry";
import { InMemoryModelProviderRegistry } from "./provider-registry";
import { ModelRuntime } from "./runtime";

/**
 * The model boundary. The same shape `ToolRuntime`'s tests take: authorised
 * calls succeed, unresolved profiles and providers fail safely, timeouts and
 * cancellation are enforced and cleaned up, and whatever a provider throws is
 * normalised rather than trusted.
 */

const PROFILE = {
  id: "design-engineer-default",
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
  fallbackModels: [],
};

const RESPONSE_SCHEMA = { type: "object" };

function providerThat(
  generate: (request: ModelRequest, context: ModelProviderContext) => Promise<unknown>,
  id = "openrouter",
): ModelProvider {
  return {
    id,
    generate: generate as ModelProvider["generate"],
  };
}

function runtimeFor(
  provider: ModelProvider,
  profile = PROFILE,
  options: { defaultTimeoutMs?: number } = {},
): ModelRuntime {
  return new ModelRuntime({
    profiles: new InMemoryModelProfileRegistry([profile]),
    providers: new InMemoryModelProviderRegistry([provider]),
    ...options,
  });
}

const CALL = {
  requestId: "req-1",
  profileId: "design-engineer-default",
  messages: [{ role: "user" as const, content: "hi" }],
  responseSchema: RESPONSE_SCHEMA,
};

function expectFailure(result: ModelResult): Extract<ModelResult, { type: "failure" }> {
  if (result.type !== "failure") throw new Error(`expected a failure, got ${result.type}`);
  return result;
}

// ── 12. Resolves the correct provider ───────────────────────────

describe("an authorised call", () => {
  test("resolves the profile to its declared provider and model", async () => {
    let seen: ModelRequest | null = null;

    const runtime = runtimeFor(
      providerThat((request) => {
        seen = request;
        return Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: { ok: true },
          durationMs: 1,
        });
      }),
    );

    const result = await runtime.generate(CALL);

    expect(result.type).toBe("success");
    expect(seen?.model).toBe("openai/gpt-4o-mini");
    expect(seen?.profileId).toBe("design-engineer-default");
  });

  test("passes a restricted context and nothing else", async () => {
    let keys: readonly string[] = [];

    const runtime = runtimeFor(
      providerThat((request, context) => {
        keys = Object.keys(context);
        return Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: {},
          durationMs: 1,
        });
      }),
    );

    await runtime.generate(CALL);

    expect([...keys].sort()).toEqual(["logger", "metadata", "signal"]);
  });
});

// ── Profile and provider resolution fail safely ─────────────────

describe("resolution", () => {
  test("an unresolved profile fails with a stable code, not a throw", async () => {
    const runtime = runtimeFor(providerThat(() => Promise.resolve({})));

    const result = await runtime.generate({ ...CALL, profileId: "nobody" });

    expect(expectFailure(result).code).toBe("ERR_MODEL_PROFILE_NOT_FOUND");
  });

  test("an unresolved provider fails with a stable code", async () => {
    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        { ...PROFILE, providerId: "not-installed" },
      ]),
      providers: new InMemoryModelProviderRegistry(),
    });

    const result = await runtime.generate(CALL);

    expect(expectFailure(result).code).toBe("ERR_MODEL_PROVIDER_NOT_FOUND");
  });

  test("a malformed request throws, because there is no id to fail on", async () => {
    const runtime = runtimeFor(providerThat(() => Promise.resolve({})));

    await expect(
      runtime.generate({ ...CALL, requestId: "" }),
    ).rejects.toThrow(DesignFlowError);
  });
});

// ── 16/17. Invalid provider output is rejected ──────────────────

describe("response validation", () => {
  test("a malformed provider response fails as ERR_MODEL_RESPONSE_INVALID", async () => {
    // Missing required fields entirely.
    const runtime = runtimeFor(providerThat(() => Promise.resolve({ wrong: true })));

    const result = await runtime.generate(CALL);

    expect(expectFailure(result).code).toBe("ERR_MODEL_RESPONSE_INVALID");
  });

  test("output is carried through as unknown, not re-validated by the runtime", async () => {
    // The runtime only validates the envelope. Whether `output` satisfies the
    // caller's own schema is the caller's job — see `decision-prompt.test.ts`
    // and the agent-level tests for that second, independent check.
    const runtime = runtimeFor(
      providerThat((request) =>
        Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: { anything: "at all", nested: { deeply: true } },
          durationMs: 1,
        }),
      ),
    );

    const result = await runtime.generate(CALL);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.output).toEqual({ anything: "at all", nested: { deeply: true } });
    }
  });
});

// ── 18/19/20. Timeout, cancellation, cleanup ────────────────────

describe("timeout and cancellation", () => {
  test("a provider that never returns is stopped by the timeout", async () => {
    const runtime = runtimeFor(
      providerThat(() => new Promise(() => {})),
      { ...PROFILE, timeoutMs: 40 },
    );

    const startedAt = performance.now();
    const result = await runtime.generate(CALL);
    const elapsed = performance.now() - startedAt;

    const failure = expectFailure(result);
    expect(failure.code).toBe("ERR_MODEL_TIMEOUT");
    expect(failure.retryable).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
  });

  test("a cooperative provider sees the composed signal fire", async () => {
    let observedAbort = false;

    const runtime = runtimeFor(
      providerThat(
        (_request, context) =>
          new Promise((resolve) => {
            context.signal.addEventListener("abort", () => {
              observedAbort = true;
              resolve({
                requestId: "req-1",
                providerId: "openrouter",
                model: "m",
                output: {},
                durationMs: 1,
              });
            });
          }),
      ),
      { ...PROFILE, timeoutMs: 20 },
    );

    await runtime.generate(CALL);

    expect(observedAbort).toBe(true);
  });

  test("parent cancellation propagates and is reported, not swallowed", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15);

    const runtime = runtimeFor(
      providerThat(() => new Promise(() => {})),
      { ...PROFILE, timeoutMs: 5_000 },
    );

    const result = await runtime.generate({ ...CALL, signal: controller.signal });

    expect(expectFailure(result).code).toBe("ERR_MODEL_ABORTED");
  });

  test("an already-aborted parent refuses before the provider runs", async () => {
    const controller = new AbortController();
    controller.abort();

    let ran = false;
    const runtime = runtimeFor(
      providerThat(() => {
        ran = true;
        return Promise.resolve({});
      }),
    );

    const result = await runtime.generate({ ...CALL, signal: controller.signal });

    expect(expectFailure(result).code).toBe("ERR_MODEL_ABORTED");
    expect(ran).toBe(false);
  });

  test("the parent listener is removed after every call", async () => {
    const controller = new AbortController();
    const { signal } = controller;

    const added: unknown[] = [];
    const removed: unknown[] = [];
    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);

    signal.addEventListener = ((...args: Parameters<typeof originalAdd>) => {
      added.push(args[1]);
      return originalAdd(...args);
    }) as typeof signal.addEventListener;
    signal.removeEventListener = ((...args: Parameters<typeof originalRemove>) => {
      removed.push(args[1]);
      return originalRemove(...args);
    }) as typeof signal.removeEventListener;

    const runtime = runtimeFor(
      providerThat((request) =>
        Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: {},
          durationMs: 1,
        }),
      ),
    );

    for (let index = 0; index < 5; index++) {
      await runtime.generate({ ...CALL, requestId: `req-${index}`, signal });
    }

    expect(added.length).toBe(5);
    expect(removed.length).toBe(5);
  });

  test("the timer is cleared when a provider returns promptly", async () => {
    const cleared: unknown[] = [];
    const originalClear = globalThis.clearTimeout;

    globalThis.clearTimeout = ((handle: Parameters<typeof originalClear>[0]) => {
      cleared.push(handle);
      return originalClear(handle);
    }) as typeof globalThis.clearTimeout;

    try {
      await runtimeFor(
        providerThat((request) =>
          Promise.resolve({
            requestId: request.requestId,
            providerId: "openrouter",
            model: request.model,
            output: {},
            durationMs: 1,
          }),
        ),
      ).generate(CALL);
    } finally {
      globalThis.clearTimeout = originalClear;
    }

    expect(cleared.length).toBeGreaterThanOrEqual(1);
  });
});

// ── 21/22/23/24. Provider error normalisation ───────────────────

describe("normalising a thrown provider error", () => {
  test("a recognised code passes through", async () => {
    const runtime = runtimeFor(
      providerThat(() =>
        Promise.reject(
          new DesignFlowError("ERR_MODEL_AUTHENTICATION", "credential rejected"),
        ),
      ),
    );

    const result = await runtime.generate(CALL);
    const failure = expectFailure(result);

    expect(failure.code).toBe("ERR_MODEL_AUTHENTICATION");
    expect(failure.retryable).toBe(false);
  });

  test("rate limits normalise correctly and are marked retryable", async () => {
    const runtime = runtimeFor(
      providerThat(() =>
        Promise.reject(new DesignFlowError("ERR_MODEL_RATE_LIMITED", "slow down")),
      ),
    );

    const failure = expectFailure(await runtime.generate(CALL));
    expect(failure.code).toBe("ERR_MODEL_RATE_LIMITED");
    expect(failure.retryable).toBe(true);
  });

  test("unavailable-model errors normalise correctly", async () => {
    const runtime = runtimeFor(
      providerThat(() =>
        Promise.reject(new DesignFlowError("ERR_MODEL_UNAVAILABLE", "no such model")),
      ),
    );

    expect(expectFailure(await runtime.generate(CALL)).code).toBe("ERR_MODEL_UNAVAILABLE");
  });

  test("an unrecognised code is collapsed to ERR_MODEL_PROVIDER_FAILED", async () => {
    // A provider cannot mint an internal code the runtime does not know.
    const runtime = runtimeFor(
      providerThat(() =>
        Promise.reject(new DesignFlowError("ERR_SOMETHING_MADE_UP", "surprise")),
      ),
    );

    expect(expectFailure(await runtime.generate(CALL)).code).toBe(
      "ERR_MODEL_PROVIDER_FAILED",
    );
  });

  test("a generic exception is collapsed to ERR_MODEL_PROVIDER_FAILED", async () => {
    const runtime = runtimeFor(
      providerThat(() => Promise.reject(new TypeError("fetch failed"))),
    );

    expect(expectFailure(await runtime.generate(CALL)).code).toBe(
      "ERR_MODEL_PROVIDER_FAILED",
    );
  });

  test("no raw response, secret or stack trace survives", async () => {
    const runtime = runtimeFor(
      providerThat(() => {
        const error = new Error("boom");
        error.stack = "Error: boom\n    at /Users/someone/secret/path.ts:1:1";
        return Promise.reject(
          Object.assign(error, { rawResponse: { authorization: "Bearer sk-leak" } }),
        );
      }),
    );

    const result = await runtime.generate(CALL);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("/Users/someone");
    expect(serialized).not.toContain("    at ");
    expect(serialized).not.toContain("sk-leak");
    expect(serialized).not.toContain("Bearer");
  });

  test("a long or multi-line message is collapsed and truncated", async () => {
    const runtime = runtimeFor(
      providerThat(() => Promise.reject(new Error(`line one\n\nline two ${"x".repeat(5_000)}`))),
    );

    const failure = expectFailure(await runtime.generate(CALL));
    expect(failure.message).not.toContain("\n");
    expect(failure.message.length).toBeLessThanOrEqual(201);
  });
});

// ── What the runtime does not do ────────────────────────────────

describe("what the runtime does not do", () => {
  test("calls the provider exactly once and never retries", async () => {
    let calls = 0;

    const runtime = runtimeFor(
      providerThat(() => {
        calls += 1;
        return Promise.reject(new Error("fail"));
      }),
    );

    await runtime.generate(CALL);

    expect(calls).toBe(1);
  });

  test("reports installed profile ids for narrowing, not the profiles themselves", () => {
    const runtime = runtimeFor(providerThat(() => Promise.resolve({})));

    expect(runtime.installedProfileIds()).toEqual(["design-engineer-default"]);
  });

  test("fallback models are forwarded only when the profile configured them", async () => {
    let seenFallbacks: readonly string[] = [];

    const runtime = runtimeFor(
      providerThat((request) => {
        seenFallbacks = request.fallbackModels;
        return Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: {},
          durationMs: 1,
        });
      }),
      { ...PROFILE, fallbackModels: ["openai/gpt-4o"] },
    );

    await runtime.generate(CALL);

    expect(seenFallbacks).toEqual(["openai/gpt-4o"]);
  });

  test("routing policy comes only from the resolved profile, never from the caller", async () => {
    let seenRouting: unknown;

    const runtime = runtimeFor(
      providerThat((request) => {
        seenRouting = request.providerRouting;
        return Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: {},
          durationMs: 1,
        });
      }),
      { ...PROFILE, providerRouting: { order: ["openai"], allowFallbacks: false } },
    );

    // The caller's request has no field for routing at all — `CALL` proves
    // that structurally, since it compiles without one.
    await runtime.generate(CALL);

    expect(seenRouting).toEqual({ order: ["openai"], allowFallbacks: false });
  });

  test("a hostile provider cannot widen its own timeout by mutating its manifest", async () => {
    // Providers have no manifest to mutate — timeout is a profile field the
    // runtime reads once per call, not something the provider object carries.
    // This test exists to document that the class of Stage 36 bug (a tool
    // widening its own declared timeout) has no analogue here: there is
    // nothing on `ModelProvider` for a hostile implementation to mutate.
    const provider: ModelProvider = {
      id: "openrouter",
      generate: () => new Promise(() => {}),
    };

    const runtime = runtimeFor(provider, { ...PROFILE, timeoutMs: 30 });
    const result = await runtime.generate(CALL);

    expect(expectFailure(result).code).toBe("ERR_MODEL_TIMEOUT");
  });
});
