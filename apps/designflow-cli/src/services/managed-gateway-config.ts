import { readSupabasePublicConfig } from "./supabase-config";

export interface ManagedGatewayConfig {
  readonly endpoint: string;
  readonly publishableKey: string;
  readonly sessionToken?: string;
}

/**
 * Reads only public gateway location and an optional session token from the
 * process environment. Nothing is persisted in DesignFlow settings, and this
 * function has no OpenRouter credential path by design.
 */
export function readManagedGatewayConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly includeDefault?: boolean } = {},
): ManagedGatewayConfig | undefined {
  const publicConfig = readSupabasePublicConfig(environment);
  const configuredEndpoint = environment["DESIGNFLOW_AI_GATEWAY_URL"]?.trim();
  const endpoint = configuredEndpoint ||
    (options.includeDefault === true ? publicConfig.gatewayUrl : undefined);
  if (endpoint === undefined || endpoint.length === 0) return undefined;

  const sessionToken = environment["DESIGNFLOW_AI_GATEWAY_TOKEN"]?.trim();
  return {
    endpoint,
    publishableKey: publicConfig.publishableKey,
    ...(sessionToken !== undefined && sessionToken.length > 0 ? { sessionToken } : {}),
  };
}
