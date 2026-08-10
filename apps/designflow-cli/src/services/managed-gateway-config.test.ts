import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatch } from "../cli";
import { createCliContext } from "./cli-runner";
import { readManagedGatewayConfig } from "./managed-gateway-config";
import { ScriptedTerminal } from "../ui/terminal";

const homes: string[] = [];

afterEach(() => {
  delete process.env["DESIGNFLOW_HOME"];
  delete process.env["DESIGNFLOW_AI_GATEWAY_URL"];
  delete process.env["DESIGNFLOW_AI_GATEWAY_TOKEN"];
  delete process.env["DESIGNFLOW_SUPABASE_URL"];
  delete process.env["DESIGNFLOW_SUPABASE_PUBLISHABLE_KEY"];
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("readManagedGatewayConfig", () => {
  test("reads only the public endpoint and optional session token", () => {
    expect(readManagedGatewayConfig({
      DESIGNFLOW_AI_GATEWAY_URL: " https://project.supabase.co/functions/v1/ai-gateway ",
      DESIGNFLOW_AI_GATEWAY_TOKEN: " session-token ",
      OPENROUTER_API_KEY: "sk-never-read-here",
    })).toEqual({
      endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
      publishableKey: expect.any(String),
      sessionToken: "session-token",
    });
  });

  test("does not activate the managed provider without an endpoint", () => {
    expect(readManagedGatewayConfig(
      { DESIGNFLOW_AI_GATEWAY_TOKEN: "session-token" },
      { includeDefault: false },
    )).toBeUndefined();
  });

  test("uses the built-in DesignFlow gateway when the normal product path opts in", () => {
    expect(readManagedGatewayConfig({}, { includeDefault: true })).toMatchObject({
      endpoint: "https://qmgvvonyqzpgnnmtwohb.supabase.co/functions/v1/ai-gateway",
      publishableKey: "sb_publishable_p35k4DPA6hBsk5jhy5R6UQ_DARPKoSr",
    });
  });

  test("composition root selects the managed provider without contacting it", () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-managed-config-"));
    homes.push(home);
    process.env["DESIGNFLOW_HOME"] = home;
    process.env["DESIGNFLOW_AI_GATEWAY_URL"] = "http://127.0.0.1:54321/functions/v1/ai-gateway";
    process.env["DESIGNFLOW_AI_GATEWAY_TOKEN"] = "session-token";

    const context = createCliContext({ databasePath: join(home, "runs.json") });
    try {
      expect(context.modelProviderConfigured).toBe(true);
      expect(context.modelAssignments.length).toBeGreaterThan(0);
      expect(new Set(context.modelAssignments.map((assignment) => assignment.providerId))).toEqual(
        new Set(["designflow-managed"]),
      );
    } finally {
      context.close();
    }
  });

  test("bare interactive composition uses the built-in gateway without environment setup", () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-managed-default-"));
    homes.push(home);
    process.env["DESIGNFLOW_HOME"] = home;

    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      autoConnectFigmaDesktop: true,
    });
    try {
      expect(context.aiStatus()).toBe("sign-in-required");
      expect(context.modelAssignments.every((assignment) => assignment.providerId === "designflow-managed")).toBe(true);
    } finally {
      context.close();
    }
  });

  test("bare interactive Google sign-in uses the built-in Supabase origin", async () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-google-default-"));
    homes.push(home);
    process.env["DESIGNFLOW_HOME"] = home;
    // Reproduce a stale shell override from the pre-launch scaffold. The
    // normal product path must still resolve the canonical built-in project.
    process.env["DESIGNFLOW_SUPABASE_URL"] = "https://project.supabase.co";
    delete process.env["DESIGNFLOW_SUPABASE_PUBLISHABLE_KEY"];

    let authorizationUrl = "";
    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      autoConnectFigmaDesktop: true,
      authClientOverrides: {
        openBrowser: async (url) => {
          authorizationUrl = url;
          return true;
        },
        callbackServerFactory: async () => ({
          redirectUri: "http://127.0.0.1:53682/auth/callback",
          result: Promise.resolve({ code: "oauth-code" }),
          close: async () => {},
        }),
        fetchImpl: async () => new Response(JSON.stringify({
          access_token: "supabase-access-token",
          refresh_token: "supabase-refresh-token",
          expires_in: 3_600,
          user: { id: "user-1" },
        }), { status: 200 }),
      },
    });

    try {
      const terminal = new ScriptedTerminal(["", "q"]);
      await dispatch([], context, terminal);
      expect(new URL(authorizationUrl).origin).toBe("https://qmgvvonyqzpgnnmtwohb.supabase.co");
      expect(new URL(authorizationUrl).pathname).toBe("/auth/v1/authorize");
      expect(terminal.transcript).toContain("AI\n  Connected");
    } finally {
      context.close();
    }
  });

  test("restores a valid persisted session without opening Google again", () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-managed-session-"));
    homes.push(home);
    process.env["DESIGNFLOW_HOME"] = home;
    mkdirSync(join(home, "auth"), { recursive: true });
    writeFileSync(join(home, "auth", "session.json"), JSON.stringify({
      version: 1,
      accessToken: "persisted-access-token",
      refreshToken: "persisted-refresh-token",
      expiresAt: Date.now() + 60_000,
      user: { id: "user-1" },
    }));

    const context = createCliContext({
      databasePath: join(home, "runs.json"),
      autoConnectFigmaDesktop: true,
    });
    try {
      expect(context.aiStatus()).toBe("connected");
      expect(context.modelProviderConfigured).toBe(true);
    } finally {
      context.close();
    }
  });
});
