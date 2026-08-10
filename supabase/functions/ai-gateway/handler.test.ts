import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handleAiGatewayRequest } from "./handler";
import { MANAGED_MODEL, MANAGED_MODEL_ROUTES } from "./contract";

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

    expect(designEngineerProfiles.every((profileId) => MANAGED_MODEL_ROUTES[profileId] === MANAGED_MODEL)).toBe(true);

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
      expect(upstreamBody?.model).toBe(MANAGED_MODEL);
      expect(upstreamBody?.models).toBeUndefined();
      expect(upstreamBody?.provider).toBeUndefined();
      expect((await result.json() as Record<string, unknown>).model).toBe(MANAGED_MODEL);
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
