import { describe, expect, test } from "bun:test";
import { SupabaseUsageLedger, UsageLedgerUnavailableError, estimateReservedTokens } from "./usage";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("Supabase usage ledger", () => {
  test("reserves through the server RPC without storing prompts", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ledger = new SupabaseUsageLedger({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "server-role-secret",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return response({ allowed: true, reservation_id: "server-request-1" });
      },
    });

    const result = await ledger.reserve({ userId: "auth-user", profileId: "implementation-default", effectiveModel: "openai/gpt-4o-mini", reservedTokens: 100 });
    expect(result).toEqual({ allowed: true, reservation: { requestId: "server-request-1", reservedCostUsd: 0.1, reservedTokens: 100 } });
    expect(calls[0]?.url).toBe("https://project.supabase.co/rest/v1/rpc/designflow_reserve_ai_usage");
    expect(calls[0]?.init.headers).toEqual({ Authorization: "Bearer server-role-secret", apikey: "server-role-secret", "Content-Type": "application/json" });
    const body = String(calls[0]?.init.body);
    expect(body).toContain("auth-user");
    expect(body).toContain("implementation-default");
    expect(body).not.toContain("prompt");
    expect(body).not.toContain("filesystem");
  });

  test("finalizes token and cost usage through the server RPC", async () => {
    let body = "";
    const ledger = new SupabaseUsageLedger({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "server-role-secret",
      fetchImpl: async (_url, init) => {
        body = String(init?.body);
        return response({ ok: true, updated: true });
      },
    });

    await ledger.finalize({ requestId: "server-request-1", status: "succeeded", inputTokens: 50, outputTokens: 6, totalTokens: 56, actualCostUsd: 0.0000111 });
    expect(body).toContain('"p_input_tokens":50');
    expect(body).toContain('"p_total_tokens":56');
    expect(body).toContain('"p_actual_cost_usd":0.0000111');
  });

  test("maps rate/quota decisions and hides malformed responses", async () => {
    const ledger = new SupabaseUsageLedger({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "server-role-secret",
      fetchImpl: async () => response({ allowed: false, code: "ERR_MODEL_QUOTA_EXCEEDED", message: "safe quota", retry_after_seconds: 86400 }),
    });
    await expect(ledger.reserve({ userId: "auth-user", profileId: "implementation-default", effectiveModel: "openai/gpt-4o-mini", reservedTokens: 100 })).resolves.toEqual({ allowed: false, code: "ERR_MODEL_QUOTA_EXCEEDED", message: "safe quota", retryAfterSeconds: 86400 });

    const malformed = new SupabaseUsageLedger({ supabaseUrl: "https://project.supabase.co", serviceRoleKey: "server-role-secret", fetchImpl: async () => response({ allowed: false, code: "secret-internal-code" }) });
    await expect(malformed.reserve({ userId: "auth-user", profileId: "implementation-default", effectiveModel: "openai/gpt-4o-mini", reservedTokens: 100 })).rejects.toBeInstanceOf(UsageLedgerUnavailableError);
  });

  test("estimates a bounded conservative token reservation", () => {
    expect(estimateReservedTokens("{}", undefined)).toBe(32_002);
  });
});
