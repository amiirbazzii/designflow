export interface ManagedGatewayConfig {
  readonly endpoint: string;
  readonly sessionToken?: string;
}

/**
 * Reads only public gateway location and an optional session token from the
 * process environment. Nothing is persisted in DesignFlow settings, and this
 * function has no OpenRouter credential path by design.
 */
export function readManagedGatewayConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ManagedGatewayConfig | undefined {
  const endpoint = environment["DESIGNFLOW_AI_GATEWAY_URL"]?.trim();
  if (endpoint === undefined || endpoint.length === 0) return undefined;

  const sessionToken = environment["DESIGNFLOW_AI_GATEWAY_TOKEN"]?.trim();
  return {
    endpoint,
    ...(sessionToken !== undefined && sessionToken.length > 0 ? { sessionToken } : {}),
  };
}
