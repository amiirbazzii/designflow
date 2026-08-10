import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCliContext } from "./cli-runner";
import { readManagedGatewayConfig } from "./managed-gateway-config";

const homes: string[] = [];

afterEach(() => {
  delete process.env["DESIGNFLOW_HOME"];
  delete process.env["DESIGNFLOW_AI_GATEWAY_URL"];
  delete process.env["DESIGNFLOW_AI_GATEWAY_TOKEN"];
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
