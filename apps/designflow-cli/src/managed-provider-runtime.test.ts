import { describe, expect, test } from "bun:test";
import {
  InMemoryModelProfileRegistry,
  InMemoryModelProviderRegistry,
  ModelRuntime,
} from "@designflow/models";
import { ManagedGatewayProvider } from "@designflow/model-provider-openrouter";

describe("managed provider model-runtime integration", () => {
  test("resolves through ModelRuntime and preserves normalized usage", async () => {
    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([{
        id: "design-engineer-default",
        providerId: "designflow-managed",
        model: "openai/gpt-4o-mini",
        fallbackModels: [],
      }]),
      providers: new InMemoryModelProviderRegistry([
        new ManagedGatewayProvider({
          endpoint: "https://project.supabase.co/functions/v1/ai-gateway",
          sessionToken: "session-test-token",
          fetchImpl: async () => new Response(JSON.stringify({
            requestId: "runtime-1",
            providerId: "openrouter",
            model: "openai/gpt-4o-mini",
            output: { decision: "run" },
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
            durationMs: 4,
          }), { status: 200 }),
        }),
      ]),
    });

    const result = await runtime.generate({
      requestId: "runtime-1",
      profileId: "design-engineer-default",
      messages: [{ role: "user", content: "decide" }],
      responseSchema: { type: "object" },
    });

    expect(result).toMatchObject({
      type: "success",
      providerId: "designflow-managed",
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    });
  });
});
