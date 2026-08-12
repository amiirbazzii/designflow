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

/** Attempt provenance carries a measured per-candidate duration; compare the policy facts. */
function codesOf(
  attempts: readonly { model: string; code: string; durationMs?: number }[] | undefined,
): readonly { model: string; code: string }[] | undefined {
  return attempts?.map(({ model, code }) => ({ model, code }));
}

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
        previousFailures: [expect.objectContaining({ model: "model-a", code: "ERR_MODEL_SCHEMA_UNSUPPORTED" })],
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
      expect(codesOf(result.attempts)).toEqual([{ model: "model-a", code: "ERR_MODEL_AUTHENTICATION" }]);
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
      expect(codesOf(result.attempts)).toEqual([
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
      "ERR_MODEL_REQUEST_SCHEMA_INVALID",
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
        previousFailures: [expect.objectContaining({ model: "openai/gpt-5.6-luna", code: "ERR_MODEL_SCHEMA_UNSUPPORTED" })],
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

describe("candidate timeouts vs caller aborts (field run 101df3e3)", () => {
  /** Providers whose per-model behavior is 'hang' (never resolves) or fast success. */
  function timingProvider(hangs: readonly string[], calls: string[]): ModelProvider {
    return {
      id: "openrouter",
      generate: (async (request: ModelRequest, context: { signal: AbortSignal }) => {
        calls.push(request.model);
        if (hangs.includes(request.model)) {
          return new Promise((_, reject) => {
            context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
        return {
          requestId: request.requestId,
          providerId: "openrouter",
          model: request.model,
          output: { answer: request.model },
          durationMs: 1,
        };
      }) as never,
    };
  }

  const SPEC_LIKE = {
    id: "spec-policy",
    providerId: "openrouter",
    model: "model-a",
    fallbackModels: ["model-b", "model-c"],
    timeoutMs: 40,
  };

  test("A: a candidate-request timeout falls back; the next candidate succeeds with provenance", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(timingProvider(["model-a"], calls), SPEC_LIKE).generate(call());
    expect(calls).toEqual(["model-a", "model-b"]);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.selection).toEqual({
        model: "model-b",
        candidateIndex: 1,
        candidateCount: 3,
        previousFailures: [expect.objectContaining({ model: "model-a", code: "ERR_MODEL_TIMEOUT" })],
      });
    }
  });

  test("B: two candidate timeouts then success — exactly three calls", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(timingProvider(["model-a", "model-b"], calls), SPEC_LIKE).generate(call());
    expect(calls).toEqual(["model-a", "model-b", "model-c"]);
    expect(result.type).toBe("success");
    if (result.type === "success") expect(result.selection?.candidateIndex).toBe(2);
  });

  test("C: all candidates time out — typed bounded exhaustion with every attempt", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(timingProvider(["model-a", "model-b", "model-c"], calls), SPEC_LIKE).generate(call());
    expect(calls).toEqual(["model-a", "model-b", "model-c"]);
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.code).toBe("ERR_MODEL_CANDIDATES_EXHAUSTED");
      expect(codesOf(result.attempts)).toEqual([
        { model: "model-a", code: "ERR_MODEL_TIMEOUT" },
        { model: "model-b", code: "ERR_MODEL_TIMEOUT" },
        { model: "model-c", code: "ERR_MODEL_TIMEOUT" },
      ]);
    }
  });

  test("D: a root abort while the primary is active is terminal — no fallback candidate is called", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const pending = runtimeWith(timingProvider(["model-a"], calls), SPEC_LIKE).generate({
      ...call(),
      signal: controller.signal,
    } as never);
    setTimeout(() => controller.abort(), 10);
    const result = await pending;
    expect(calls).toEqual(["model-a"]);
    expect(result.type).toBe("failure");
    if (result.type === "failure") expect(result.code).toBe("ERR_MODEL_ABORTED");
  });

  test("E/F: an exhausted outer deadline after a candidate timeout stops before the next candidate", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    // The outer deadline fires while candidate A is still hanging: A fails
    // with its candidate timeout... but by then the caller has no budget
    // left, so candidate B must never start.
    setTimeout(() => controller.abort(), 20);
    const slowAbortProfile = { ...SPEC_LIKE, timeoutMs: 60 };
    const result = await runtimeWith(timingProvider(["model-a"], calls), slowAbortProfile).generate({
      ...call(),
      signal: controller.signal,
    } as never);
    expect(calls).toEqual(["model-a"]);
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.code).toBe("ERR_MODEL_ABORTED");
    }
  });
});
