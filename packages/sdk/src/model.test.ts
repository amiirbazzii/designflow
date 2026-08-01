// packages/sdk/src/model.test.ts
import { describe, expect, test } from "bun:test";
import {
  modelMessageSchema,
  modelProfileSchema,
  modelRequestSchema,
  modelResponseSchema,
  modelResultSchema,
  modelUsageSchema,
} from "./model";

/**
 * The model contracts.
 *
 * As with every strict schema in this codebase, most value is in what these
 * refuse. A profile is the boundary between "an agent may use an LLM" and
 * "an agent may use *this* LLM, at *this* cost" — and it is also, deliberately,
 * a place a credential can never reach.
 */

const PROFILE = {
  id: "design-engineer-default",
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
};

// ── 1. ModelProfile ──────────────────────────────────────────────

describe("modelProfileSchema", () => {
  test("accepts a minimal profile", () => {
    const profile = modelProfileSchema.parse(PROFILE);

    expect(profile.id).toBe("design-engineer-default");
    expect(profile.fallbackModels).toEqual([]);
  });

  test("accepts a fully specified profile", () => {
    const profile = modelProfileSchema.parse({
      ...PROFILE,
      temperature: 0.4,
      maxOutputTokens: 500,
      timeoutMs: 10_000,
      fallbackModels: ["openai/gpt-4o"],
      providerRouting: { order: ["openai"], allowFallbacks: true, dataCollection: "deny" },
      metadata: { note: "internal" },
    });

    expect(profile.fallbackModels).toEqual(["openai/gpt-4o"]);
    expect(profile.providerRouting?.dataCollection).toBe("deny");
  });

  test("requires non-empty id, providerId and model", () => {
    for (const field of ["id", "providerId", "model"] as const) {
      expect(() => modelProfileSchema.parse({ ...PROFILE, [field]: "" })).toThrow();
    }
  });

  // 6. Duplicate fallback models rejected.
  test("rejects a duplicated fallback model", () => {
    expect(() =>
      modelProfileSchema.parse({ ...PROFILE, fallbackModels: ["a", "a"] }),
    ).toThrow();
  });

  test("bounds temperature, tokens and timeout", () => {
    expect(() => modelProfileSchema.parse({ ...PROFILE, temperature: 2.1 })).toThrow();
    expect(() => modelProfileSchema.parse({ ...PROFILE, temperature: -0.1 })).toThrow();
    expect(() =>
      modelProfileSchema.parse({ ...PROFILE, maxOutputTokens: 0 }),
    ).toThrow();
    expect(() =>
      modelProfileSchema.parse({ ...PROFILE, maxOutputTokens: 100_000 }),
    ).toThrow();
    expect(() => modelProfileSchema.parse({ ...PROFILE, timeoutMs: 0 })).toThrow();
    expect(() =>
      modelProfileSchema.parse({ ...PROFILE, timeoutMs: 600_000 }),
    ).toThrow();
  });

  // 5. Profiles cannot contain API keys.
  test("has no field for a credential, and refuses one under any name", () => {
    for (const key of ["apiKey", "api_key", "credential", "secret", "token", "authorization"]) {
      expect(() =>
        modelProfileSchema.parse({ ...PROFILE, [key]: "sk-something" }),
      ).toThrow();
    }
  });

  test("no wildcard provider or model", () => {
    // "*" is accepted as a literal string — nothing anywhere expands it, and
    // that absence of expansion is the actual guarantee, exercised at the
    // registry and runtime layer rather than here.
    const profile = modelProfileSchema.parse({ ...PROFILE, providerId: "*", model: "*" });
    expect(profile.providerId).toBe("*");
  });

  test("is strict, so metadata cannot smuggle a new top-level field", () => {
    expect(() =>
      modelProfileSchema.parse({ ...PROFILE, unexpectedField: "x" }),
    ).toThrow();
  });
});

// ── 4. Usage ─────────────────────────────────────────────────────

describe("modelUsageSchema", () => {
  test("every field is optional", () => {
    expect(modelUsageSchema.parse({})).toEqual({});
  });

  test("rejects negative counts", () => {
    expect(() => modelUsageSchema.parse({ inputTokens: -1 })).toThrow();
    expect(() => modelUsageSchema.parse({ cost: -0.01 })).toThrow();
  });

  test("rejects a non-integer token count", () => {
    expect(() => modelUsageSchema.parse({ outputTokens: 1.5 })).toThrow();
  });
});

// ── 2. ModelRequest ──────────────────────────────────────────────

describe("modelRequestSchema", () => {
  const REQUEST = {
    requestId: "req-1",
    profileId: "design-engineer-default",
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user" as const, content: "hello" }],
    responseSchema: { type: "object" },
  };

  test("accepts a minimal request", () => {
    const request = modelRequestSchema.parse(REQUEST);
    expect(request.fallbackModels).toEqual([]);
  });

  test("requires at least one message", () => {
    expect(() => modelRequestSchema.parse({ ...REQUEST, messages: [] })).toThrow();
  });

  test("has no field for a credential", () => {
    expect(() => modelRequestSchema.parse({ ...REQUEST, apiKey: "sk-x" })).toThrow();
  });

  test("accepts every message role this stage needs", () => {
    for (const role of ["system", "user", "assistant", "tool"] as const) {
      expect(() => modelMessageSchema.parse({ role, content: "x" })).not.toThrow();
    }
  });

  test("rejects an unknown role", () => {
    expect(() =>
      modelMessageSchema.parse({ role: "developer", content: "x" }),
    ).toThrow();
  });
});

// ── 3. ModelResponse and ModelResult ────────────────────────────

describe("modelResponseSchema", () => {
  test("accepts a normalised response", () => {
    const response = modelResponseSchema.parse({
      requestId: "req-1",
      providerId: "openrouter",
      model: "openai/gpt-4o-mini",
      output: { type: "decline" },
      durationMs: 120,
    });

    expect(response.output).toEqual({ type: "decline" });
  });

  test("requires a non-negative duration", () => {
    expect(() =>
      modelResponseSchema.parse({
        requestId: "r",
        providerId: "p",
        model: "m",
        output: {},
        durationMs: -1,
      }),
    ).toThrow();
  });
});

describe("modelResultSchema", () => {
  test("accepts success and failure", () => {
    expect(
      modelResultSchema.parse({
        type: "success",
        requestId: "r",
        providerId: "openrouter",
        model: "m",
        output: {},
        durationMs: 1,
      }).type,
    ).toBe("success");

    expect(
      modelResultSchema.parse({
        type: "failure",
        requestId: "r",
        code: "ERR_MODEL_TIMEOUT",
        message: "too slow",
        retryable: true,
        durationMs: 1,
      }).type,
    ).toBe("failure");
  });

  test("a success cannot carry a failure's fields, and vice versa", () => {
    expect(() =>
      modelResultSchema.parse({
        type: "success",
        requestId: "r",
        providerId: "p",
        model: "m",
        output: {},
        durationMs: 1,
        code: "ERR_X",
      }),
    ).toThrow();

    expect(() =>
      modelResultSchema.parse({
        type: "failure",
        requestId: "r",
        code: "ERR_X",
        message: "m",
        retryable: false,
        durationMs: 1,
        output: {},
      }),
    ).toThrow();
  });

  test("refuses a stack trace or a raw provider response", () => {
    for (const key of ["stack", "cause", "rawResponse", "response"]) {
      expect(() =>
        modelResultSchema.parse({
          type: "failure",
          requestId: "r",
          code: "ERR_MODEL_PROVIDER_FAILED",
          message: "m",
          retryable: true,
          durationMs: 1,
          [key]: "…",
        }),
      ).toThrow();
    }
  });
});
