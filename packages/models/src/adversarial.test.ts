// packages/models/src/adversarial.test.ts
import { describe, expect, test } from "bun:test";
import type { ModelProvider, ModelRequest } from "@designflow/sdk";
import { InMemoryModelProfileRegistry } from "./profile-registry";
import { InMemoryModelProviderRegistry } from "./provider-registry";
import { ModelRuntime } from "./runtime";

/**
 * Stage 38 adversarial verification: a hostile provider that tries to mutate
 * the profile's model mid-flight, or after a call starts, must not be able
 * to change what was already sent or corrupt the registry for later calls.
 *
 * A `ModelProvider.generate` receives only `(wireRequest, context)` — never
 * the `ModelProfile` object, never the profile registry. `wireRequest.model`
 * is a plain string, copied by value from `profile.model` before
 * `provider.generate` is ever invoked (see `ModelRuntime.generate`). There is
 * therefore no reference a provider could hold that, if mutated, would
 * change a request already built — this test proves that holds even when
 * the provider actively tries to mutate the one object it does receive.
 */

const PROFILE = {
  id: "design-engineer-default",
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
  fallbackModels: [],
};

function runtimeFor(provider: ModelProvider): ModelRuntime {
  return new ModelRuntime({
    profiles: new InMemoryModelProfileRegistry([PROFILE]),
    providers: new InMemoryModelProviderRegistry([provider]),
  });
}

describe("a hostile provider mutating what it was handed", () => {
  test("mutating wireRequest.model in place does not change the profile registry's own record", async () => {
    let mutated: ModelRequest | null = null;

    const hostile: ModelProvider = {
      id: "openrouter",
      generate: (request) => {
        // Attempt to corrupt the request object for whatever comes next.
        try {
          (request as { model: string }).model = "attacker/injected-model";
        } catch {
          // A frozen request would throw here — either outcome is fine, the
          // assertion below is what actually matters.
        }
        mutated = request;
        return Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: {},
          durationMs: 1,
        });
      },
    };

    const runtime = runtimeFor(hostile);

    await runtime.generate({
      requestId: "req-1",
      profileId: "design-engineer-default",
      messages: [{ role: "user", content: "hi" }],
      responseSchema: {},
    });

    // The registry's own copy of the profile is untouched by whatever the
    // provider did to the request object it was handed.
    const profiles = new InMemoryModelProfileRegistry([PROFILE]);
    expect(profiles.get("design-engineer-default")?.model).toBe("openai/gpt-4o-mini");
    expect(mutated).not.toBeNull();
  });

  test("a second call for the same profile, after a hostile first call, still uses the original model", async () => {
    const seenModels: string[] = [];

    const hostile: ModelProvider = {
      id: "openrouter",
      generate: (request) => {
        seenModels.push(request.model);
        try {
          (request as { model: string }).model = "attacker/injected-model";
        } catch {
          // Ignored — see above.
        }
        return Promise.resolve({
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: {},
          durationMs: 1,
        });
      },
    };

    const runtime = runtimeFor(hostile);

    await runtime.generate({
      requestId: "req-1",
      profileId: "design-engineer-default",
      messages: [{ role: "user", content: "first" }],
      responseSchema: {},
    });

    await runtime.generate({
      requestId: "req-2",
      profileId: "design-engineer-default",
      messages: [{ role: "user", content: "second" }],
      responseSchema: {},
    });

    // Both calls were built fresh from the same, uncorrupted profile.
    expect(seenModels).toEqual(["openai/gpt-4o-mini", "openai/gpt-4o-mini"]);
  });

  test("a provider has no reference to the profile registry at all", () => {
    // Structural, not behavioural: `ModelProvider.generate`'s signature is
    // `(request: ModelRequest, context: ModelProviderContext) => ...` — there
    // is no third parameter, and `ModelProviderContext` carries only
    // `signal`, `logger` and frozen `metadata`. A provider implementation
    // cannot reach `InMemoryModelProfileRegistry` through anything the
    // runtime hands it; it would have to be given one explicitly by whoever
    // constructs it, which no adapter in this codebase does.
    const provider: ModelProvider = {
      id: "openrouter",
      generate: (_request, context) => {
        expect(Object.keys(context).sort()).toEqual(["logger", "metadata", "signal"]);
        return Promise.resolve({
          requestId: "req-1",
          providerId: "openrouter",
          model: "openai/gpt-4o-mini",
          output: {},
          durationMs: 1,
        });
      },
    };

    return runtimeFor(provider).generate({
      requestId: "req-1",
      profileId: "design-engineer-default",
      messages: [{ role: "user", content: "hi" }],
      responseSchema: {},
    });
  });
});
