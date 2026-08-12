import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleAiGatewayRequest } from "./handler";
import { MANAGED_MODEL, MANAGED_MODEL_ROUTES, classifyUpstreamStatus } from "./contract";
import type { UsageFinalizationInput, UsageLedger, UsageReservationInput } from "./usage";

const REQUEST = {
  requestId: "gateway-1",
  profileId: "design-engineer-default",
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "decide" }],
  responseSchema: { type: "object", additionalProperties: false },
  fallbackModels: [],
};

function request(body: unknown = REQUEST, token = "local-test-token"): Request {
  return new Request("https://project.supabase.co/functions/v1/ai-gateway", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("ai-gateway Edge Function handler", () => {
  function usageLedger(
    reserve: (input: UsageReservationInput) => Promise<Awaited<ReturnType<UsageLedger["reserve"]>>>,
    finalize: (input: UsageFinalizationInput) => Promise<void>,
  ): UsageLedger {
    return { reserve, finalize };
  }

  test("keeps the upstream credential read in the server entrypoint only", () => {
    const functionDir = fileURLToPath(new URL(".", import.meta.url));
    const indexSource = readFileSync(`${functionDir}index.ts`, "utf8");
    const handlerSource = readFileSync(`${functionDir}handler.ts`, "utf8");
    const contractSource = readFileSync(`${functionDir}contract.ts`, "utf8");
    const clientSource = readFileSync(
      fileURLToPath(new URL("../../../packages/model-provider-openrouter/src/managed-provider.ts", import.meta.url)),
      "utf8",
    );

    expect(indexSource).toContain('Deno.env.get("OPENROUTER_API_KEY")');
    expect(handlerSource).not.toContain("Deno.env.get(\"OPENROUTER_API_KEY\")");
    expect(contractSource).not.toContain("OPENROUTER_API_KEY");
    expect(clientSource).not.toContain("OPENROUTER_API_KEY");
  });

  test("disables the legacy platform JWT pre-check and keeps auth in the function", () => {
    const configSource = readFileSync(
      fileURLToPath(new URL("../../config.toml", import.meta.url)),
      "utf8",
    );
    expect(configSource).toMatch(/\[functions\.ai-gateway\][\s\S]*verify_jwt\s*=\s*false/);
    expect(configSource).not.toMatch(/\[functions\.ai-gateway\][\s\S]*verify_jwt\s*=\s*true/);
  });

  test("requires a bearer token and has no permanent unauthenticated mode", async () => {
    const result = await handleAiGatewayRequest(new Request("https://gateway.test", { method: "POST", body: JSON.stringify(REQUEST) }), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
    });
    expect(result.status).toBe(401);
  });

  test("normalizes upstream output and usage while keeping the credential server-side", async () => {
    let upstreamHeaders: HeadersInit | undefined;
    let upstreamBody: unknown;
    const result = await handleAiGatewayRequest(request(), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      now: (() => {
        let value = 100;
        return () => (value += 25);
      })(),
      fetchImpl: async (url, init) => {
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        upstreamHeaders = init?.headers;
        upstreamBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          id: "upstream-1",
          model: REQUEST.model,
          choices: [{ message: { content: JSON.stringify({ decision: "run" }) } }],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7, cost: 0.0002 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const body = await result.json() as Record<string, unknown>;
    expect(result.status).toBe(200);
    expect(body).toMatchObject({
      requestId: REQUEST.requestId,
      providerId: "openrouter",
      model: REQUEST.model,
      output: { decision: "run" },
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7, cost: 0.0002 },
    });
    expect(upstreamHeaders).toEqual({
      Authorization: "Bearer server-only-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.stringify(body)).not.toContain("server-only-secret");
    expect(JSON.stringify(upstreamBody)).not.toContain("filesystem");
  });

  test("routes every Design Engineer profile to the server-owned launch model", async () => {
    const designEngineerProfiles = [
      "design-engineer-coordinator-default",
      "figma-specification-default",
      "implementation-default",
      "visual-validation-default",
      "visual-correction-default",
    ];

    // Every profile's allowlist contains the launch model, and an
    // out-of-allowlist request (below) always lands on the profile default.
    expect(designEngineerProfiles.every((profileId) => MANAGED_MODEL_ROUTES[profileId]?.includes(MANAGED_MODEL) === true)).toBe(true);

    for (const [index, profileId] of designEngineerProfiles.entries()) {
      let upstreamBody: Record<string, unknown> | undefined;
      const result = await handleAiGatewayRequest(request({
        ...REQUEST,
        requestId: `route-${index}`,
        profileId,
        model: "anthropic/claude-3.5-haiku",
        fallbackModels: ["arbitrary-expensive-model"],
        providerRouting: { order: ["arbitrary-provider"], allowFallbacks: true },
      }), {
        openRouterApiKey: "server-only-secret",
        allowLocalDev: true,
        fetchImpl: async (_url, init) => {
          upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(JSON.stringify({
            id: "upstream-route",
            choices: [{ message: { content: JSON.stringify({ decision: "run" }) } }],
          }), { status: 200 });
        },
      });

      expect(result.status).toBe(200);
      const expectedDefault = MANAGED_MODEL_ROUTES[profileId]?.[0];
      expect(upstreamBody?.model).toBe(expectedDefault);
      expect(upstreamBody?.models).toBeUndefined();
      // structured output is always required, so routing must require
      // parameter-compatible providers — and never leak client routing hints.
      expect(upstreamBody?.provider).toEqual({ require_parameters: true });
      expect((await result.json() as Record<string, unknown>).model).toBe(expectedDefault);
    }
  });

  test("rejects unknown managed profiles before provider forwarding", async () => {
    let upstreamCalled = false;
    const result = await handleAiGatewayRequest(request({
      ...REQUEST,
      profileId: "unknown-production-profile",
      model: "arbitrary-expensive-model",
    }), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      fetchImpl: async () => {
        upstreamCalled = true;
        return new Response("must not reach upstream", { status: 200 });
      },
    });

    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({
      error: {
        code: "ERR_MODEL_ROUTE_NOT_FOUND",
        message: "no managed model route is configured for this profile",
        retryable: false,
      },
    });
    expect(upstreamCalled).toBe(false);
  });

  test("validates an authenticated Supabase user before forwarding to OpenRouter", async () => {
    let authHeaders: HeadersInit | undefined;
    let upstreamCalled = false;
    const result = await handleAiGatewayRequest(request(REQUEST, "user-jwt"), {
      openRouterApiKey: "server-only-secret",
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable-test",
      usageLedger: usageLedger(
        async (input) => ({ allowed: true, reservation: { requestId: "auth-test-request", reservedCostUsd: 0.1, reservedTokens: input.reservedTokens } }),
        async () => {},
      ),
      authFetchImpl: async (_url, init) => {
        authHeaders = init?.headers;
        return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
      },
      fetchImpl: async () => {
        upstreamCalled = true;
        return new Response(JSON.stringify({
          id: "upstream-1",
          model: REQUEST.model,
          choices: [{ message: { content: JSON.stringify({ decision: "run" }) } }],
        }), { status: 200 });
      },
    });

    expect(result.status).toBe(200);
    expect(upstreamCalled).toBe(true);
    expect(authHeaders).toEqual({
      Authorization: "Bearer user-jwt",
      apikey: "sb_publishable-test",
    });
  });

  test("reserves and finalizes usage using the authenticated user, not client data", async () => {
    let reservedInput: UsageReservationInput | undefined;
    let finalizedInput: UsageFinalizationInput | undefined;
    const result = await handleAiGatewayRequest(request(REQUEST, "user-jwt"), {
      openRouterApiKey: "server-only-secret",
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable-test",
      authFetchImpl: async () => new Response(JSON.stringify({ id: "auth-user" }), { status: 200 }),
      usageLedger: usageLedger(
        async (input) => {
          reservedInput = input;
          return { allowed: true, reservation: { requestId: "server-generated-request", reservedCostUsd: 0.1, reservedTokens: input.reservedTokens } };
        },
        async (input) => { finalizedInput = input; },
      ),
      fetchImpl: async () => new Response(JSON.stringify({
        id: "upstream-usage",
        choices: [{ message: { content: JSON.stringify({ decision: "run" }) } }],
        usage: { prompt_tokens: 50, completion_tokens: 6, total_tokens: 56, cost: 0.0000111 },
      }), { status: 200 }),
    });

    expect(result.status).toBe(200);
    expect(reservedInput).toMatchObject({ userId: "auth-user", profileId: REQUEST.profileId, effectiveModel: MANAGED_MODEL });
    expect(finalizedInput).toEqual({ requestId: "server-generated-request", status: "succeeded", inputTokens: 50, outputTokens: 6, totalTokens: 56, actualCostUsd: 0.0000111 });
  });

  test("provider failure finalizes a reservation and never turns it into a success", async () => {
    let finalizedInput: UsageFinalizationInput | undefined;
    const result = await handleAiGatewayRequest(request(), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      usageLedger: usageLedger(
        async () => ({ allowed: true, reservation: { requestId: "server-generated-failure", reservedCostUsd: 0.1, reservedTokens: 100 } }),
        async (input) => { finalizedInput = input; },
      ),
      fetchImpl: async () => new Response("provider unavailable", { status: 503 }),
    });

    expect(result.status).toBe(502);
    expect(finalizedInput).toEqual({ requestId: "server-generated-failure", status: "failed" });
  });

  test("missing success cost is finalized conservatively by the ledger contract", async () => {
    let finalizedInput: UsageFinalizationInput | undefined;
    const result = await handleAiGatewayRequest(request(), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      usageLedger: usageLedger(
        async () => ({ allowed: true, reservation: { requestId: "server-generated-no-cost", reservedCostUsd: 0.1, reservedTokens: 100 } }),
        async (input) => { finalizedInput = input; },
      ),
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ decision: "run" }) } }],
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      }), { status: 200 }),
    });

    expect(result.status).toBe(200);
    expect(finalizedInput).toEqual({ requestId: "server-generated-no-cost", status: "succeeded", inputTokens: 4, outputTokens: 3, totalTokens: 7 });
  });

  test("quota rejection never contacts OpenRouter", async () => {
    let upstreamCalled = false;
    const result = await handleAiGatewayRequest(request(), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      usageLedger: usageLedger(
        async () => ({ allowed: false, code: "ERR_MODEL_QUOTA_EXCEEDED", message: "the DesignFlow token quota was reached", retryAfterSeconds: 86400 }),
        async () => {},
      ),
      fetchImpl: async () => {
        upstreamCalled = true;
        return new Response("must not reach OpenRouter", { status: 200 });
      },
    });

    expect(result.status).toBe(429);
    expect((await result.json()) as unknown).toEqual({ error: { code: "ERR_MODEL_QUOTA_EXCEEDED", message: "the DesignFlow token quota was reached", retryable: true, retryAfterSeconds: 86400 } });
    expect(upstreamCalled).toBe(false);
  });

  test("disabled service rejects before usage reservation or OpenRouter", async () => {
    let reserved = false;
    let upstreamCalled = false;
    const result = await handleAiGatewayRequest(request(), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      enabled: false,
      usageLedger: usageLedger(
        async () => { reserved = true; return { allowed: true, reservation: { requestId: "never", reservedCostUsd: 0.1, reservedTokens: 100 } }; },
        async () => {},
      ),
      fetchImpl: async () => { upstreamCalled = true; return new Response("must not reach OpenRouter", { status: 200 }); },
    });

    expect(result.status).toBe(503);
    expect((await result.json()) as unknown).toEqual({ error: { code: "ERR_MODEL_SERVICE_UNAVAILABLE", message: "managed AI service protection is active", retryable: true, retryAfterSeconds: 3600 } });
    expect(reserved).toBe(false);
    expect(upstreamCalled).toBe(false);
  });

  test("production requires durable usage protection before OpenRouter", async () => {
    let upstreamCalled = false;
    const result = await handleAiGatewayRequest(request(REQUEST, "user-jwt"), {
      openRouterApiKey: "server-only-secret",
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable-test",
      authFetchImpl: async () => new Response(JSON.stringify({ id: "auth-user" }), { status: 200 }),
      fetchImpl: async () => { upstreamCalled = true; return new Response("must not reach OpenRouter", { status: 200 }); },
    });
    expect(result.status).toBe(503);
    expect(upstreamCalled).toBe(false);
  });

  test("rejects a bearer that Supabase Auth cannot validate", async () => {
    const result = await handleAiGatewayRequest(request(REQUEST, "revoked-jwt"), {
      openRouterApiKey: "server-only-secret",
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable-test",
      authFetchImpl: async () => new Response("auth details", { status: 401 }),
      fetchImpl: async () => { throw new Error("must not reach upstream"); },
    });

    expect(result.status).toBe(401);
    expect(await result.text()).not.toContain("auth details");
  });

  test("maps upstream errors to bounded safe classifications", async () => {
    const result = await handleAiGatewayRequest(request(), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      fetchImpl: async () => new Response("provider secret payload", { status: 429 }),
    });
    const body = await result.json() as { error: Record<string, unknown> };
    expect(result.status).toBe(429);
    expect(body.error).toEqual({
      code: "ERR_MODEL_RATE_LIMITED",
      message: "upstream provider rate-limited the gateway",
      retryable: true,
    });
    expect(JSON.stringify(body)).not.toContain("provider secret payload");
  });

  test("rejects unsupported request fields and missing server configuration", async () => {
    const unsupported = await handleAiGatewayRequest(request({ ...REQUEST, filesystem: "/tmp" }), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
    });
    expect(unsupported.status).toBe(400);

    const missingSecret = await handleAiGatewayRequest(request(), { allowLocalDev: true });
    expect(missingSecret.status).toBe(503);
  });

  test("rejects the local test token unless the explicit local seam is enabled", async () => {
    const result = await handleAiGatewayRequest(request(), { openRouterApiKey: "server-only-secret" });
    expect(result.status).toBe(401);
  });

  test("bounds an upstream request and classifies timeout safely", async () => {
    const result = await handleAiGatewayRequest(request(), {
      openRouterApiKey: "server-only-secret",
      allowLocalDev: true,
      timeoutMs: 1,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }),
    });
    const body = await result.json() as { error: Record<string, unknown> };
    expect(result.status).toBe(504);
    expect(body.error.code).toBe("ERR_MODEL_TIMEOUT");
  });
});

describe("upstream 400 classification (DF spec-v2 structured-output forensics)", () => {
  const cases: Array<{ body: string; code: string; contains: string }> = [
    {
      body: JSON.stringify({ error: { message: "Invalid schema for response_format 'designflow_structured_output': too many properties" } }),
      code: "ERR_MODEL_SCHEMA_UNSUPPORTED",
      contains: "too many properties",
    },
    {
      body: JSON.stringify({ error: { message: "openai/gpt-5.6-luna is not a valid model ID" } }),
      code: "ERR_MODEL_UNAVAILABLE",
      contains: "not a valid model",
    },
    {
      body: JSON.stringify({ error: { message: "No endpoints found that support the requested parameters" } }),
      code: "ERR_MODEL_OUTPUT_UNSUPPORTED",
      contains: "No endpoints found",
    },
  ];

  for (const { body, code, contains } of cases) {
    test(`a 400 body mapping to ${code} preserves the sanitized upstream reason`, () => {
      const failure = classifyUpstreamStatus(400, body);
      expect(failure.code).toBe(code);
      expect(failure.message).toContain(contains);
    });
  }

  test("upstream reasons are sanitized: no keys, no urls, bounded length", () => {
    const failure = classifyUpstreamStatus(400, JSON.stringify({
      error: { message: `schema rejected sk-or-v1-abcdef1234567890 see https://openrouter.ai/errors ${"x".repeat(600)}` },
    }));
    expect(failure.message).not.toContain("sk-or-v1");
    expect(failure.message).not.toContain("https://");
    expect(failure.message.length).toBeLessThan(400);
  });

  test("a bodyless 400 keeps the legacy schema-unsupported mapping", () => {
    expect(classifyUpstreamStatus(400).code).toBe("ERR_MODEL_SCHEMA_UNSUPPORTED");
  });
});

describe("per-profile candidate allowlists", () => {
  test("an allowed Specification candidate is honored; a foreign model routes to the default", async () => {
    for (const [requested, expected] of [
      ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-pro"],
      ["openai/gpt-4o-mini", "openai/gpt-4o-mini"],
      ["anthropic/claude-3.5-haiku", "openai/gpt-5.6-luna"],
    ] as const) {
      let upstreamBody: Record<string, unknown> | undefined;
      const result = await handleAiGatewayRequest(request({
        ...REQUEST,
        requestId: `allow-${requested}`,
        profileId: "figma-specification-default",
        model: requested,
      }), {
        openRouterApiKey: "server-only-secret",
        allowLocalDev: true,
        fetchImpl: async (_url, init) => {
          upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(JSON.stringify({
            id: "upstream-allow",
            choices: [{ message: { content: JSON.stringify({ decision: "run" }) } }],
          }), { status: 200 });
        },
      });
      expect(result.status).toBe(200);
      expect(upstreamBody?.model).toBe(expected);
    }
  });
});
