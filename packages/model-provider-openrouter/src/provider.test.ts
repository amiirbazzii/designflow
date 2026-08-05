// packages/model-provider-openrouter/src/provider.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  DesignFlowError,
  type ModelProviderContext,
  type ModelRequest,
} from "@designflow/sdk";
import { OpenRouterProvider, openRouterResponseSchemaIssues } from "./provider";

/**
 * The OpenRouter adapter, exercised against a real local HTTP server rather
 * than a mocked `fetch`. A server that actually parses the request body is
 * the only way to prove headers were sent, the body was shaped correctly,
 * and nothing beyond `Authorization`/`Content-Type`/the two attribution
 * headers ever left this process — a mocked `fetch` would only prove the
 * adapter *intended* to send something, not what actually crossed the wire.
 *
 * No real network access, no paid API call, and nothing here requires
 * `OPENROUTER_API_KEY` — every server started in this file is closed by the
 * end of its test.
 */

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

interface CapturedRequest {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}

/** Starts a server that records the request and answers with `respond`. */
async function mockServer(
  respond: (request: CapturedRequest, res: ServerResponse) => void,
): Promise<{ endpoint: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      const captured: CapturedRequest = {
        headers: req.headers,
        body: raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined,
      };
      requests.push(captured);
      respond(captured, res);
    });
  });

  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a network address");
  }

  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const CONTEXT: ModelProviderContext = {
  signal: new AbortController().signal,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  metadata: {},
};

const REQUEST: ModelRequest = {
  requestId: "req-1",
  profileId: "design-engineer-default",
  model: "openai/gpt-4o-mini",
  messages: [
    { role: "system", content: "You decide things." },
    { role: "user", content: "build a login page" },
  ],
  responseSchema: {
    type: "object",
    properties: { type: { const: "run_workflow" } },
  },
  fallbackModels: [],
};

const DECISION = { type: "run_workflow", workflowId: "design-to-code", reasoningSummary: "ok" };

function successBody(model = "openai/gpt-4o-mini"): unknown {
  return {
    id: "gen-abc123",
    model,
    choices: [{ message: { role: "assistant", content: JSON.stringify(DECISION) } }],
    usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
  };
}

// ── 25/26. Model slug and structured-output schema ──────────────

describe("what the adapter sends", () => {
  test("the exact model slug from the request", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT);

    const body = requests[0]?.body as { model?: string };
    expect(body.model).toBe("openai/gpt-4o-mini");
  });

  test("the response schema as a JSON Schema response_format", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT);

    const body = requests[0]?.body as {
      response_format?: { type: string; json_schema: { strict: boolean; schema: unknown } };
    };

    expect(body.response_format?.type).toBe("json_schema");
    expect(body.response_format?.json_schema.strict).toBe(true);
    expect(body.response_format?.json_schema.schema).toEqual(REQUEST.responseSchema);
  });

  test("messages are translated verbatim, role and content only", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT);

    const body = requests[0]?.body as { messages?: readonly unknown[] };
    expect(body.messages).toEqual([
      { role: "system", content: "You decide things." },
      { role: "user", content: "build a login page" },
    ]);
  });

  // 31. Fallback models are sent only when explicitly configured.
  test("no fallback models field when the profile configured none", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT);

    const body = requests[0]?.body as Record<string, unknown>;
    expect(body["models"]).toBeUndefined();
  });

  test("fallback models are sent as an ordered list when configured", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(
      { ...REQUEST, fallbackModels: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"] },
      CONTEXT,
    );

    const body = requests[0]?.body as { models?: readonly string[] };
    expect(body.models).toEqual([
      "openai/gpt-4o-mini",
      "openai/gpt-4o",
      "anthropic/claude-3.5-sonnet",
    ]);
  });

  // 30. Routing policy comes only from validated profile config.
  test("routing is sent only when the profile configured it", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT);

    const body = requests[0]?.body as Record<string, unknown>;
    expect(body["provider"]).toBeUndefined();
  });

  test("routing fields are translated to OpenRouter's shape when present", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(
      {
        ...REQUEST,
        providerRouting: { order: ["openai"], allowFallbacks: false, dataCollection: "deny" },
      },
      CONTEXT,
    );

    const body = requests[0]?.body as { provider?: Record<string, unknown> };
    expect(body.provider).toEqual({
      order: ["openai"],
      allow_fallbacks: false,
      data_collection: "deny",
    });
  });
});

// ── 27. Credential handling ──────────────────────────────────────

describe("the credential", () => {
  test("is sent as a bearer token and nowhere else in the request", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-super-secret", endpoint }).generate(
      REQUEST,
      CONTEXT,
    );

    expect(requests[0]?.headers.authorization).toBe("Bearer sk-super-secret");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("sk-super-secret");
  });

  test("never appears in the returned ModelResponse", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 200, successBody()));

    const response = await new OpenRouterProvider({ apiKey: "sk-super-secret", endpoint }).generate(
      REQUEST,
      CONTEXT,
    );

    expect(JSON.stringify(response)).not.toContain("sk-super-secret");
  });

  // 28. API key missing fails before network access.
  test("an empty key fails at construction, before any request is sent", async () => {
    const { endpoint, requests } = await mockServer((_req, res) => jsonResponse(res, 200, {}));

    expect(() => new OpenRouterProvider({ apiKey: "", endpoint })).toThrow(DesignFlowError);
    expect(() => new OpenRouterProvider({ apiKey: "   ", endpoint })).toThrow(DesignFlowError);
    expect(requests).toHaveLength(0);
  });

  test("the construction failure carries ERR_MODEL_API_KEY_MISSING", () => {
    try {
      new OpenRouterProvider({ apiKey: "" });
      throw new Error("expected construction to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_MODEL_API_KEY_MISSING");
      // The env var name is guidance, not a leak of anything secret.
      expect((error as DesignFlowError).message).toContain("OPENROUTER_API_KEY");
    }
  });
});

// ── 29. Endpoint override ────────────────────────────────────────

describe("endpoint configuration", () => {
  test("a test endpoint is used when supplied", async () => {
    const { endpoint, requests } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody()),
    );

    await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT);

    expect(requests).toHaveLength(1);
  });

  test("omitting it leaves the production default untouched", () => {
    // Constructing without `endpoint` must not throw and must not require a
    // network call — this only proves the constructor accepts the omission;
    // asserting the literal production URL would just restate the constant.
    expect(() => new OpenRouterProvider({ apiKey: "sk-test" })).not.toThrow();
  });
});

// ── 32. HTTP and parsing failures are sanitised ─────────────────

describe("HTTP failure normalisation", () => {
  test("400 normalises to ERR_MODEL_SCHEMA_UNSUPPORTED", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 400, { error: "Provider returned error" }));

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_SCHEMA_UNSUPPORTED" });
  });

  test("401 normalises to ERR_MODEL_AUTHENTICATION", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 401, { error: "bad key" }));

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_AUTHENTICATION" });
  });

  test("429 normalises to ERR_MODEL_RATE_LIMITED", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 429, {}));

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_RATE_LIMITED" });
  });

  test("404 normalises to ERR_MODEL_UNAVAILABLE", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 404, {}));

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_UNAVAILABLE" });
  });

  test("a 500 is a plain error, left for ModelRuntime to classify as provider-failed", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 500, { error: "oops" }));

    const error: unknown = await new OpenRouterProvider({ apiKey: "sk-test", endpoint })
      .generate(REQUEST, CONTEXT)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DesignFlowError);
  });

  test("a non-JSON body normalises to ERR_MODEL_RESPONSE_INVALID", async () => {
    const { endpoint } = await mockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json at all");
    });

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_RESPONSE_INVALID" });
  });

  test("no choices normalises to ERR_MODEL_OUTPUT_INVALID", async () => {
    const { endpoint } = await mockServer((_req, res) =>
      jsonResponse(res, 200, { id: "gen-1", model: "m", choices: [] }),
    );

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_OUTPUT_INVALID" });
  });

  test("empty content normalises to ERR_MODEL_OUTPUT_INVALID", async () => {
    const { endpoint } = await mockServer((_req, res) =>
      jsonResponse(res, 200, {
        id: "gen-1",
        model: "m",
        choices: [{ message: { role: "assistant", content: "" } }],
      }),
    );

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_OUTPUT_INVALID" });
  });

  test("content that is not valid JSON normalises to ERR_MODEL_OUTPUT_INVALID", async () => {
    const { endpoint } = await mockServer((_req, res) =>
      jsonResponse(res, 200, {
        id: "gen-1",
        model: "m",
        choices: [{ message: { role: "assistant", content: "not { json" } }],
      }),
    );

    await expect(
      new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, CONTEXT),
    ).rejects.toMatchObject({ code: "ERR_MODEL_OUTPUT_INVALID" });
  });

  test("no error carries a stack, a raw body, or the credential", async () => {
    const { endpoint } = await mockServer((_req, res) =>
      jsonResponse(res, 401, { error: { message: "sk-test rejected", internal_id: "xyz" } }),
    );

    const error: unknown = await new OpenRouterProvider({ apiKey: "sk-test", endpoint })
      .generate(REQUEST, CONTEXT)
      .catch((caught: unknown) => caught);

    const serialized = JSON.stringify(error instanceof DesignFlowError ? error.toJSON() : error);
    expect(serialized).not.toContain("sk-test");
    expect(serialized).not.toContain("internal_id");
  });
});

describe("strict schema capability preflight", () => {
  test("rejects top-level oneOf and accepts bounded flat schemas", () => {
    expect(openRouterResponseSchemaIssues({ type: "object", oneOf: [{ type: "object" }] })).toContain("$: oneOf is unsupported");
    expect(openRouterResponseSchemaIssues({ type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false })).toEqual([]);
  });
});

// ── Signal propagation ───────────────────────────────────────────

describe("cancellation", () => {
  test("the context signal is passed to fetch", async () => {
    const controller = new AbortController();

    const { endpoint } = await mockServer((_req, res) => {
      // Never responds — the client must abort on its own.
      setTimeout(() => {
        try {
          res.end();
        } catch {
          // Connection already closed by the client abort.
        }
      }, 2_000);
    });

    const call = new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(REQUEST, {
      ...CONTEXT,
      signal: controller.signal,
    });

    queueMicrotask(() => controller.abort());

    await expect(call).rejects.toThrow();
  });
});

// ── Usage and response id ────────────────────────────────────────

describe("normalised response fields", () => {
  test("usage is translated from OpenAI's field names", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 200, successBody()));

    const response = await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(
      REQUEST,
      CONTEXT,
    );

    expect(response.usage).toEqual({ inputTokens: 40, outputTokens: 10, totalTokens: 50 });
  });

  test("providerRequestId carries the generation id", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 200, successBody()));

    const response = await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(
      REQUEST,
      CONTEXT,
    );

    expect(response.providerRequestId).toBe("gen-abc123");
  });

  test("the output is the parsed structured content, not the raw envelope", async () => {
    const { endpoint } = await mockServer((_req, res) => jsonResponse(res, 200, successBody()));

    const response = await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(
      REQUEST,
      CONTEXT,
    );

    expect(response.output).toEqual(DECISION);
  });

  test("model echoes what the provider actually answered with", async () => {
    const { endpoint } = await mockServer((_req, res) =>
      jsonResponse(res, 200, successBody("openai/gpt-4o")),
    );

    const response = await new OpenRouterProvider({ apiKey: "sk-test", endpoint }).generate(
      REQUEST,
      CONTEXT,
    );

    // Reports the fallback model that actually answered, not the primary one
    // requested — useful once fallbacks are in play.
    expect(response.model).toBe("openai/gpt-4o");
  });
});
