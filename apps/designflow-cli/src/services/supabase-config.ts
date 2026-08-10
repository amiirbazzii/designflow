export const DEFAULT_SUPABASE_URL = "https://qmgvvonyqzpgnnmtwohb.supabase.co";
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_p35k4DPA6hBsk5jhy5R6UQ_DARPKoSr";

export interface SupabasePublicConfig {
  readonly url: string;
  readonly publishableKey: string;
  readonly authUrl: string;
  readonly gatewayUrl: string;
}

/** Public client configuration only. No service-role or upstream key belongs here. */
export function readSupabasePublicConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SupabasePublicConfig {
  const url = environment["DESIGNFLOW_SUPABASE_URL"]?.trim() || DEFAULT_SUPABASE_URL;
  const publishableKey =
    environment["DESIGNFLOW_SUPABASE_PUBLISHABLE_KEY"]?.trim() ||
    DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DesignFlow Supabase URL is invalid.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && parsed.hostname === "127.0.0.1")) {
    throw new Error("DesignFlow Supabase URL must use HTTPS (or local HTTP for development).");
  }

  const base = parsed.toString().replace(/\/$/, "");
  return {
    url: base,
    publishableKey,
    authUrl: `${base}/auth/v1`,
    gatewayUrl: `${base}/functions/v1/ai-gateway`,
  };
}
