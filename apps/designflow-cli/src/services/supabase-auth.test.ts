import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AuthSessionError } from "./auth-session";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CALLBACK_PORT,
  SupabaseAuthClient,
} from "./supabase-auth";
import { OAuthCallbackError, type OAuthCallbackServer } from "./oauth-callback";

function sessionServer(): OAuthCallbackServer {
  return {
    redirectUri: `http://127.0.0.1:${GOOGLE_CALLBACK_PORT}${GOOGLE_CALLBACK_PATH}`,
    result: Promise.resolve({ code: "oauth-code" }),
    close: async () => {},
  };
}

describe("SupabaseAuthClient Google PKCE", () => {
  test("creates a Google S256 authorization flow and exchanges only the code", async () => {
    let authorizationUrl = "";
    let tokenBody: unknown;
    const client = new SupabaseAuthClient({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable-test",
      openBrowser: async (url) => {
        authorizationUrl = url;
        return true;
      },
      callbackServerFactory: async (options) => {
        expect(options.state.length).toBeGreaterThan(20);
        return sessionServer();
      },
      fetchImpl: async (_url, init) => {
        tokenBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          access_token: "supabase-access-token",
          refresh_token: "supabase-refresh-token",
          expires_in: 3_600,
          user: { id: "user-1", email: "person@example.com" },
        }), { status: 200 });
      },
      now: () => 1_000,
    });

    const session = await client.signInWithGoogle();
    const parsed = new URL(authorizationUrl);

    expect(parsed.searchParams.get("provider")).toBe("google");
    expect(parsed.searchParams.get("redirect_to")).toBe(`http://127.0.0.1:${GOOGLE_CALLBACK_PORT}${GOOGLE_CALLBACK_PATH}`);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")?.length).toBeGreaterThan(20);
    expect(tokenBody).toMatchObject({ auth_code: "oauth-code" });
    expect(tokenBody).toHaveProperty("code_verifier");
    const verifier = (tokenBody as { code_verifier: string }).code_verifier;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(parsed.searchParams.get("code_challenge"));
    expect(JSON.stringify(tokenBody)).not.toContain("supabase-access-token");
    expect(JSON.stringify(tokenBody)).not.toContain("provider_token");
    expect(JSON.stringify(tokenBody)).not.toContain("google-refresh-token");
    expect(session.accessToken).toBe("supabase-access-token");
  });

  test("prints a safe fallback when browser opening is unavailable", async () => {
    let fallback = "";
    const client = new SupabaseAuthClient({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable-test",
      openBrowser: async () => false,
      callbackServerFactory: async () => sessionServer(),
      fetchImpl: async () => new Response(JSON.stringify({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      }), { status: 200 }),
      now: () => 1_000,
    });

    await client.signInWithGoogle((url) => { fallback = url; });
    expect(fallback).toContain("provider=google");
  });

  test("maps callback cancellation, timeout and revoked refresh safely", async () => {
    const cancelled = new SupabaseAuthClient({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable-test",
      callbackServerFactory: async () => ({
        ...sessionServer(),
        result: Promise.reject(new AuthSessionError("Google sign-in was cancelled.", "cancelled")),
      }),
    });
    await expect(cancelled.signInWithGoogle()).rejects.toMatchObject({ code: "cancelled" });

    const revoked = new SupabaseAuthClient({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable-test",
      fetchImpl: async () => new Response("provider details", { status: 401 }),
    });
    await expect(revoked.refreshSession("refresh-token")).rejects.toMatchObject({
      code: "auth-required",
      message: "AI connection needs sign-in.",
    });
  });

  test("maps a loopback port conflict to a bounded product error", async () => {
    const client = new SupabaseAuthClient({
      url: "https://project.supabase.co",
      publishableKey: "sb_publishable-test",
      callbackServerFactory: async () => {
        throw new OAuthCallbackError(
          "port-unavailable",
          "Could not start Google sign-in. The local sign-in port is already in use.",
        );
      },
    });

    await expect(client.signInWithGoogle()).rejects.toMatchObject({
      code: "port-unavailable",
      message: "Could not start Google sign-in. The local sign-in port is already in use.",
    });
  });
});
