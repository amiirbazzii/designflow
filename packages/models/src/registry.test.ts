// packages/models/src/registry.test.ts
import { describe, expect, test } from "bun:test";
import {
  DesignFlowError,
  type ModelProfile,
  type ModelProvider,
} from "@designflow/sdk";
import { InMemoryModelProfileRegistry } from "./profile-registry";
import { InMemoryModelProviderRegistry } from "./provider-registry";

/**
 * The two registries. Registration and resolution only — nothing here calls
 * a provider, exactly like `InMemoryToolRegistry` and `InMemoryAgentRegistry`
 * before it.
 */

const PROFILE: ModelProfile = {
  id: "design-engineer-default",
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
  fallbackModels: [],
};

function provider(id = "openrouter"): ModelProvider {
  return {
    id,
    generate: () =>
      Promise.resolve({
        requestId: "r",
        providerId: id,
        model: "m",
        output: {},
        durationMs: 1,
      }),
  };
}

// ── 7/8. Provider registry ──────────────────────────────────────

describe("registering a provider", () => {
  test("resolves what was registered", () => {
    const registry = new InMemoryModelProviderRegistry([provider()]);
    expect(registry.get("openrouter")?.id).toBe("openrouter");
  });

  test("refuses a duplicate id", () => {
    const registry = new InMemoryModelProviderRegistry([provider()]);

    try {
      registry.register(provider());
      throw new Error("expected a duplicate to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe(
        "ERR_MODEL_PROVIDER_ALREADY_REGISTERED",
      );
    }
  });

  test("a duplicate does not replace the incumbent", () => {
    const first = provider();
    const registry = new InMemoryModelProviderRegistry([first]);

    expect(() => registry.register(provider())).toThrow();
    expect(registry.get("openrouter")).toBe(first);
  });

  test("returns undefined for an unregistered id", () => {
    expect(new InMemoryModelProviderRegistry().get("nobody")).toBeUndefined();
  });

  test("lists registered ids", () => {
    const registry = new InMemoryModelProviderRegistry([provider("a"), provider("b")]);
    expect(registry.ids()).toEqual(["a", "b"]);
  });
});

// ── 9/10/11. Profile registry ────────────────────────────────────

describe("registering a profile", () => {
  test("validates at the boundary", () => {
    const registry = new InMemoryModelProfileRegistry();
    expect(() =>
      registry.register({ ...PROFILE, id: "" }),
    ).toThrow();
  });

  test("resolves what was registered", () => {
    const registry = new InMemoryModelProfileRegistry([PROFILE]);
    expect(registry.get("design-engineer-default")?.model).toBe("openai/gpt-4o-mini");
  });

  test("refuses a duplicate id", () => {
    const registry = new InMemoryModelProfileRegistry([PROFILE]);

    try {
      registry.register(PROFILE);
      throw new Error("expected a duplicate to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe(
        "ERR_MODEL_PROFILE_ALREADY_REGISTERED",
      );
    }
  });

  test("a duplicate does not replace the incumbent", () => {
    const registry = new InMemoryModelProfileRegistry([PROFILE]);

    expect(() =>
      registry.register({ ...PROFILE, model: "something-else" }),
    ).toThrow();
    expect(registry.get(PROFILE.id)?.model).toBe("openai/gpt-4o-mini");
  });

  test("missing profile and provider both answer undefined, never throw", () => {
    // 11. Missing profile and provider errors — surfaced as `undefined` here;
    // `ModelRuntime` is what turns that into the stable, returned failure.
    expect(new InMemoryModelProfileRegistry().get("nobody")).toBeUndefined();
    expect(new InMemoryModelProviderRegistry().get("nobody")).toBeUndefined();
  });

  test("lists and reports ids", () => {
    const registry = new InMemoryModelProfileRegistry([
      PROFILE,
      { ...PROFILE, id: "other" },
    ]);

    expect(registry.ids()).toEqual(["design-engineer-default", "other"]);
    expect(registry.list()).toHaveLength(2);
    expect(registry.has("other")).toBe(true);
    expect(registry.has("nope")).toBe(false);
  });
});
