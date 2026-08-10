import { handleAiGatewayRequest } from "./handler.ts";

Deno.serve((request: Request) => handleAiGatewayRequest(request, {
  // This is the only production code path that reads the upstream secret.
  // It is never accepted from request data and never included in a response.
  openRouterApiKey: Deno.env.get("OPENROUTER_API_KEY"),
  // This seam is intentionally opt-in and is for local Supabase development
  // only. Deployed functions keep Supabase JWT verification enabled.
  allowLocalDev: Deno.env.get("AI_GATEWAY_ALLOW_LOCAL_DEV") === "true",
}));
