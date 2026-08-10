import { handleAiGatewayRequest } from "./handler.ts";

Deno.serve((request: Request) => handleAiGatewayRequest(request, {
  // This is the only production code path that reads the upstream secret.
  // It is never accepted from request data and never included in a response.
  openRouterApiKey: Deno.env.get("OPENROUTER_API_KEY"),
  // These are public Supabase client values used only to validate the bearer
  // through Auth's /user endpoint. They never authorize a request by
  // themselves and are not upstream provider credentials.
  supabaseUrl: Deno.env.get("SUPABASE_URL"),
  supabasePublishableKey: Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"),
  // This seam is intentionally opt-in and is for local Supabase development
  // only. Deployed functions keep Supabase JWT verification enabled.
  allowLocalDev: Deno.env.get("AI_GATEWAY_ALLOW_LOCAL_DEV") === "true",
}));
