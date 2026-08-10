import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  DEFAULT_SUPABASE_URL,
  readSupabasePublicConfig,
} from "./supabase-config";

describe("Supabase public configuration", () => {
  test("provides the built-in project without environment variables", () => {
    const config = readSupabasePublicConfig({});
    expect(config).toEqual({
      url: DEFAULT_SUPABASE_URL,
      publishableKey: DEFAULT_SUPABASE_PUBLISHABLE_KEY,
      authUrl: `${DEFAULT_SUPABASE_URL}/auth/v1`,
      gatewayUrl: `${DEFAULT_SUPABASE_URL}/functions/v1/ai-gateway`,
    });
  });

  test("supports safe development overrides", () => {
    expect(readSupabasePublicConfig({
      DESIGNFLOW_SUPABASE_URL: "https://local-project.supabase.co/",
      DESIGNFLOW_SUPABASE_PUBLISHABLE_KEY: "sb_publishable-local",
    })).toMatchObject({
      url: "https://local-project.supabase.co",
      publishableKey: "sb_publishable-local",
      authUrl: "https://local-project.supabase.co/auth/v1",
      gatewayUrl: "https://local-project.supabase.co/functions/v1/ai-gateway",
    });
  });

  test("rejects non-HTTPS remote overrides", () => {
    expect(() => readSupabasePublicConfig({ DESIGNFLOW_SUPABASE_URL: "http://example.test" }))
      .toThrow("must use HTTPS");
  });
});
