// packages/models/src/model-policy.test.ts
//
// The generic per-agent ordered model policy: deterministic candidate order,
// explicit fallback eligibility, truthful stops for global failures, bounded
// exhaustion with sanitized provenance, and byte-identical behavior for
// single-model legacy profiles.
import { describe, expect, test } from "bun:test";
import {
  DesignFlowError,
  type ModelProvider,
  type ModelRequest,
} from "@designflow/sdk";
import { InMemoryModelProfileRegistry } from "./profile-registry";
import { InMemoryModelProviderRegistry } from "./provider-registry";
import { ModelRuntime } from "./runtime";
import { FALLBACK_ELIGIBLE_MODEL_ERROR_CODES, isFallbackEligibleModelError } from "./errors";

const RESPONSE_SCHEMA = { type: "object" };

const POLICY_PROFILE = {
  id: "spec-policy",
  providerId: "openrouter",
  model: "model-a",
  fallbackModels: ["model-b", "model-c"],
};

function call(profileId = "spec-policy") {
  return {
    requestId: "req-policy",
    profileId,
    messages: [{ role: "user" as const, content: "hi" }],
    responseSchema: RESPONSE_SCHEMA,
  };
}

/** A provider whose behavior is scripted per model slug. */
function scriptedProvider(
  script: Record<string, "success" | string>,
  calls: string[],
): ModelProvider {
  return {
    id: "openrouter",
    generate: async (request: ModelRequest) => {
      calls.push(request.model);
      const behavior = script[request.model] ?? "success";
      if (behavior === "success") {
        return {
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: { answer: request.model },
          durationMs: 1,
        };
      }
      throw new DesignFlowError(behavior, `scripted failure for ${request.model}`);
    },
  };
}

function runtimeWith(provider: ModelProvider, profile: object = POLICY_PROFILE): ModelRuntime {
  return new ModelRuntime({
    profiles: new InMemoryModelProfileRegistry([profile as never]),
    providers: new InMemoryModelProviderRegistry([provider]),
  });
}

describe("ordered model policy", () => {
  test("A: primary succeeds — only the primary is called and provenance says primary", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(scriptedProvider({ "model-a": "success" }, calls)).generate(call());
    expect(calls).toEqual(["model-a"]);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.selection?.candidateIndex).toBe(0);
      expect(result.selection?.previousFailures).toEqual([]);
    }
  });

  test("B: schema-unsupported on the primary falls back; provenance records the failure", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(
      scriptedProvider({ "model-a": "ERR_MODEL_SCHEMA_UNSUPPORTED", "model-b": "success" }, calls),
    ).generate(call());
    expect(calls).toEqual(["model-a", "model-b"]);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.model).toBe("model-b");
      expect(result.selection).toEqual({
        model: "model-b",
        candidateIndex: 1,
        candidateCount: 3,
        previousFailures: [{ model: "model-a", code: "ERR_MODEL_SCHEMA_UNSUPPORTED" }],
      });
    }
  });

  test("C: two eligible failures then success — exactly three bounded calls", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(
      scriptedProvider({ "model-a": "ERR_MODEL_UNAVAILABLE", "model-b": "ERR_MODEL_SCHEMA_UNSUPPORTED", "model-c": "success" }, calls),
    ).generate(call());
    expect(calls).toEqual(["model-a", "model-b", "model-c"]);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.selection?.candidateIndex).toBe(2);
      expect(result.selection?.previousFailures).toHaveLength(2);
    }
  });

  test("E: authentication failure stops truthfully — no further candidate is invoked", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(
      scriptedProvider({ "model-a": "ERR_MODEL_AUTHENTICATION" }, calls),
    ).generate(call());
    expect(calls).toEqual(["model-a"]);
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.code).toBe("ERR_MODEL_AUTHENTICATION");
      expect(result.attempts).toEqual([{ model: "model-a", code: "ERR_MODEL_AUTHENTICATION" }]);
    }
  });

  test("F: exhaustion produces one typed terminal failure with bounded sanitized attempts", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(
      scriptedProvider({ "model-a": "ERR_MODEL_UNAVAILABLE", "model-b": "ERR_MODEL_SERVICE_UNAVAILABLE", "model-c": "ERR_MODEL_SCHEMA_UNSUPPORTED" }, calls),
    ).generate(call());
    expect(calls).toEqual(["model-a", "model-b", "model-c"]);
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.code).toBe("ERR_MODEL_CANDIDATES_EXHAUSTED");
      expect(result.attempts).toEqual([
        { model: "model-a", code: "ERR_MODEL_UNAVAILABLE" },
        { model: "model-b", code: "ERR_MODEL_SERVICE_UNAVAILABLE" },
        { model: "model-c", code: "ERR_MODEL_SCHEMA_UNSUPPORTED" },
      ]);
      expect(JSON.stringify(result)).not.toContain("scripted failure");
    }
  });

  test("G: a single-model legacy profile keeps the exact pre-policy result shape", async () => {
    const calls: string[] = [];
    const single = { id: "legacy", providerId: "openrouter", model: "model-a", fallbackModels: [] };
    const ok = await runtimeWith(scriptedProvider({}, calls), single).generate(call("legacy"));
    expect(ok.type).toBe("success");
    if (ok.type === "success") expect(ok.selection).toBeUndefined();

    const failing = await runtimeWith(
      scriptedProvider({ "model-a": "ERR_MODEL_SCHEMA_UNSUPPORTED" }, []),
      single,
    ).generate(call("legacy"));
    expect(failing.type).toBe("failure");
    if (failing.type === "failure") {
      expect(failing.code).toBe("ERR_MODEL_SCHEMA_UNSUPPORTED");
      expect(failing.attempts).toBeUndefined();
    }
  });

  test("H: one agent's fallback list cannot change another profile's selected model", async () => {
    const calls: string[] = [];
    const provider = scriptedProvider({}, calls);
    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        POLICY_PROFILE as never,
        { id: "other-agent", providerId: "openrouter", model: "model-z", fallbackModels: [] } as never,
      ]),
      providers: new InMemoryModelProviderRegistry([provider]),
    });
    const result = await runtime.generate({ ...call("other-agent") });
    expect(calls).toEqual(["model-z"]);
    expect(result.type).toBe("success");
    if (result.type === "success") expect(result.model).toBe("model-z");
  });

  test("eligibility classification is centralized and explicit", () => {
    for (const code of FALLBACK_ELIGIBLE_MODEL_ERROR_CODES) {
      expect(isFallbackEligibleModelError(code)).toBe(true);
    }
    for (const code of [
      "ERR_MODEL_AUTHENTICATION",
      "ERR_MODEL_API_KEY_MISSING",
      "ERR_MODEL_CONFIGURATION_INVALID",
      "ERR_MODEL_QUOTA_EXCEEDED",
      "ERR_MODEL_RATE_LIMITED",
      "ERR_MODEL_ABORTED",
      "ERR_MODEL_TIMEOUT",
      "ERR_MODEL_OUTPUT_INVALID",
      "ERR_MODEL_RESPONSE_INVALID",
    ]) {
      expect(isFallbackEligibleModelError(code)).toBe(false);
    }
  });
});

describe("field regression DF run ce64cc85 (ERR_MODEL_SCHEMA_UNSUPPORTED on the Specification primary)", () => {
  test("the Specification profile's primary schema-unsupported failure falls back instead of failing the run", async () => {
    const calls: string[] = [];
    const specProfile = {
      id: "figma-specification-default",
      providerId: "openrouter",
      model: "openai/gpt-5.6-luna",
      fallbackModels: ["deepseek/deepseek-v4-pro", "openai/gpt-4o-mini"],
    };
    const result = await runtimeWith(
      scriptedProvider({ "openai/gpt-5.6-luna": "ERR_MODEL_SCHEMA_UNSUPPORTED" }, calls),
      specProfile,
    ).generate(call("figma-specification-default"));

    expect(calls).toEqual(["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro"]);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.selection).toEqual({
        model: "deepseek/deepseek-v4-pro",
        candidateIndex: 1,
        candidateCount: 3,
        previousFailures: [{ model: "openai/gpt-5.6-luna", code: "ERR_MODEL_SCHEMA_UNSUPPORTED" }],
      });
    }
  });
});

describe("ordered model policy — configuration compatibility", () => {
  test("a legacy single-model override pins exactly that model: built-in fallbacks are cleared", async () => {
    const { mergeModelProfileOverrides } = await import("./config");
    const [merged] = mergeModelProfileOverrides(
      [{ ...POLICY_PROFILE, providerRouting: undefined, metadata: undefined } as never],
      { "spec-policy": { model: "user/pinned-model" } },
    );
    expect(merged?.model).toBe("user/pinned-model");
    expect(merged?.fallbackModels).toEqual([]);
  });

  test("an explicit fallbackModels override is honored verbatim", async () => {
    const { mergeModelProfileOverrides } = await import("./config");
    const [merged] = mergeModelProfileOverrides(
      [{ ...POLICY_PROFILE } as never],
      { "spec-policy": { model: "user/primary", fallbackModels: ["user/backup"] } },
    );
    expect(merged?.model).toBe("user/primary");
    expect(merged?.fallbackModels).toEqual(["user/backup"]);
  });

  test("a profile with no override keeps its built-in ordered policy", async () => {
    const { mergeModelProfileOverrides } = await import("./config");
    const [merged] = mergeModelProfileOverrides([{ ...POLICY_PROFILE } as never], {});
    expect(merged?.model).toBe("model-a");
    expect(merged?.fallbackModels).toEqual(["model-b", "model-c"]);
  });
});
