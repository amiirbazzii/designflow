import { describe, expect, test } from "bun:test";
import { type ModelProviderContext, type ModelRequest } from "@designflow/sdk";
import { ManagedGatewayProvider } from "./managed-provider";

const CONTEXT: ModelProviderContext = {
  signal: new AbortController().signal,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  metadata: {},
};
const REQUEST: ModelRequest = {
  requestId: "req-managed-1",
  profileId: "design-engineer-default",
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "decide" }],
  responseSchema: { type: "object", additionalProperties: false },
  fallbackModels: [],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("ManagedGatewayProvider", () => {
  test("sends a session token and never an upstream key", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const provider = new ManagedGatewayProvider({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      publishableKey: "sb_publishable-test",
      sessionToken: "session-test-token",
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return response({
          requestId: REQUEST.requestId,
          providerId: "openrouter",
          model: REQUEST.model,
          output: { decision: "run" },
          usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, cost: 0.0001 },
          durationMs: 12,
          providerRequestId: "upstream-1",
        });
      },
    });
    const result = await provider.generate(REQUEST, CONTEXT);
    expect(captured?.url).toBe("https://project.supabase.co/functions/v1/ai-gateway");
    expect(captured?.init.headers).toEqual({
      "Content-Type": "application/json",
      apikey: "sb_publishable-test",
      Authorization: "Bearer session-test-token",
    });
    expect(String(captured?.init.body)).not.toContain("OPENROUTER_API_KEY");
    expect(String(captured?.init.body)).not.toContain("sk-secret");
    expect(String(captured?.init.body)).not.toContain("provider_token");
    expect(String(captured?.init.body)).not.toContain("google-refresh-token");
    expect(result.providerId).toBe("designflow-managed");
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5, cost: 0.0001 });
  });

  test("does not attach Authorization without a session", async () => {
    let headers: HeadersInit | undefined;
    let authenticationRequired = false;
    const provider = new ManagedGatewayProvider({
      endpoint: "http://127.0.0.1:54321/functions/v1/ai-gateway",
      onAuthenticationRequired: () => { authenticationRequired = true; },
      fetchImpl: async (_url, init) => {
        headers = init?.headers;
        return response({ error: { code: "ERR_MODEL_AUTHENTICATION", message: "rejected", retryable: false } }, 401);
      },
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({ code: "ERR_MODEL_AUTHENTICATION" });
    expect(headers).toEqual({ "Content-Type": "application/json" });
    expect(authenticationRequired).toBe(true);
  });

  test("classifies bounded gateway errors without exposing payloads", async () => {
    const provider = new ManagedGatewayProvider({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      fetchImpl: async () => response({ error: { code: "ERR_MODEL_RATE_LIMITED", message: "secret upstream detail", retryable: true } }, 429),
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      code: "ERR_MODEL_RATE_LIMITED",
      message: "The managed AI gateway is rate-limiting requests.",
    });
  });

  test("carries a bounded retryAfterSeconds from the gateway error body", async () => {
    const provider = new ManagedGatewayProvider({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      fetchImpl: async () =>
        response({ error: { code: "ERR_MODEL_RATE_LIMITED", message: "detail", retryable: true, retryAfterSeconds: 42.4 } }, 429),
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      code: "ERR_MODEL_RATE_LIMITED",
      metadata: { retryAfterSeconds: 43 },
    });
  });

  test("drops malformed or negative retryAfterSeconds values", async () => {
    const provider = new ManagedGatewayProvider({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      fetchImpl: async () =>
        response({ error: { code: "ERR_MODEL_QUOTA_EXCEEDED", message: "detail", retryable: true, retryAfterSeconds: -5 } }, 429),
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      code: "ERR_MODEL_QUOTA_EXCEEDED",
      metadata: {},
    });
  });

  test("preserves the bounded unknown-route classification", async () => {
    const provider = new ManagedGatewayProvider({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      fetchImpl: async () => response({ error: { code: "ERR_MODEL_ROUTE_NOT_FOUND", message: "internal route detail", retryable: false } }, 400),
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      code: "ERR_MODEL_ROUTE_NOT_FOUND",
      message: "The managed AI gateway has no route for this profile.",
    });
  });

  // DF-SPEC-06: the gateway's sanitized reason must survive as structured
  // metadata, not only inside the message, so the model runtime can record it
  // against the candidate that failed.
  test("carries the gateway's bounded sanitized reason as structured metadata", async () => {
    const provider = new ManagedGatewayProvider({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      fetchImpl: async () =>
        response(
          { error: { code: "ERR_MODEL_UNAVAILABLE", message: "requested model is unavailable: openai/gpt-5.6-luna is not a valid model ID", retryable: true } },
          400,
        ),
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      code: "ERR_MODEL_UNAVAILABLE",
      metadata: { reason: "requested model is unavailable: openai/gpt-5.6-luna is not a valid model ID" },
    });
  });

  test("a gateway failure with no message carries no invented reason", async () => {
    const provider = new ManagedGatewayProvider({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      fetchImpl: async () => response({ error: { code: "ERR_MODEL_UNAVAILABLE", retryable: true } }, 404),
    });
    await expect(provider.generate(REQUEST, CONTEXT)).rejects.toMatchObject({
      code: "ERR_MODEL_UNAVAILABLE",
      metadata: {},
    });
  });

  test("rejects non-HTTPS remote endpoints", () => {
    expect(() => new ManagedGatewayProvider({ endpoint: "http://gateway.example.test" })).toThrow("must use HTTPS");
  });
});
