// packages/model-provider-openrouter/src/provider.ts
import {
  DesignFlowError,
  type ModelProvider,
  type ModelProviderContext,
  type ModelProviderCapabilities,
  type JsonSchemaObject,
  type ModelRequest,
  type ModelResponse,
} from "@designflow/sdk";

/**
 * OpenRouter as a `ModelProvider`.
 *
 * A small, explicit adapter over OpenRouter's HTTP API — no vendor SDK, so
 * DesignFlow's public architecture never couples to one. Its only job is
 * translation: a neutral `ModelRequest` in, an OpenRouter HTTP call out, a
 * neutral `ModelResponse` back. It contains no agent-specific business
 * logic — it does not know a workflow exists, does not know what a decision
 * is, and would work identically if handed a request built for an entirely
 * different purpose.
 *
 * Everything that decides *whether* to call, *how long* to wait, and *what
 * happens on cancellation* lives one layer up in `ModelRuntime`. This class
 * does not compose an `AbortController`, does not enforce a timeout and does
 * not retry — it passes `context.signal` straight to `fetch` and lets the
 * runtime own every policy question.
 */

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";
const ENV_VAR = "OPENROUTER_API_KEY";

export interface OpenRouterProviderOptions {
  /** The credential. Read by the caller from `OPENROUTER_API_KEY`, never here. */
  readonly apiKey: string;
  /**
   * Overrides the production endpoint.
   *
   * Test-only in spirit: production traffic always goes to
   * `https://openrouter.ai/api/v1`, defined as a constant inside this file
   * rather than read from configuration, so nothing outside a test can point
   * a live install at an unreviewed endpoint by accident.
   */
  readonly endpoint?: string | undefined;
  /**
   * OpenRouter's optional attribution headers.
   *
   * Neither is a secret — they identify the calling application to
   * OpenRouter's own leaderboards, the same purpose a `User-Agent` serves.
   * Safe to keep in `config.json`; nothing here is safe to keep in
   * `config.json` beyond these two.
   */
  readonly appUrl?: string | undefined;
  readonly appName?: string | undefined;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch | undefined;
}

export class OpenRouterProvider implements ModelProvider {
  public readonly id = "openrouter";

  public capabilities(_model: string): ModelProviderCapabilities {
    return { jsonMode: true, strictJsonSchema: true, toolCalling: false, maxOutputTokens: 32_000, responseSchemaIssues: openRouterResponseSchemaIssues };
  }

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly appUrl: string | undefined;
  private readonly appName: string | undefined;
  private readonly fetchImpl: typeof fetch;

  /**
   * Validates the credential immediately, before any network access.
   *
   * A provider with no key is not a provider that fails on its first call —
   * it is a provider that never gets constructed, which is what lets the CLI
   * composition root treat "no key" as a wiring-time decision rather than a
   * runtime surprise partway through a workflow.
   */
  public constructor(options: OpenRouterProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new DesignFlowError(
        "ERR_MODEL_API_KEY_MISSING",
        `No credential configured for model provider openrouter. Set ${ENV_VAR}.`,
        { providerId: "openrouter", envVar: ENV_VAR },
      );
    }

    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.appUrl = options.appUrl;
    this.appName = options.appName;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async generate(
    request: ModelRequest,
    context: ModelProviderContext,
  ): Promise<ModelResponse> {
    const startedAt = performance.now();

    const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(buildBody(request)),
      signal: context.signal,
    });

    if (!response.ok) {
      throw await errorFor(response);
    }

    const body = await parseJsonBody(response);
    const output = extractStructuredOutput(body);

    return {
      requestId: request.requestId,
      providerId: this.id,
      model: readOptionalString(body, "model") ?? request.model,
      output,
      ...(readUsage(body) !== undefined ? { usage: readUsage(body) } : {}),
      durationMs: Math.max(0, performance.now() - startedAt),
      ...(readOptionalString(body, "id") !== undefined
        ? { providerRequestId: readOptionalString(body, "id") }
        : {}),
    };
  }

  /**
   * Authorization is the one header that must never be logged.
   *
   * It is constructed here, used once by `fetch`, and returned to nothing —
   * no caller of `generate` ever sees this object, and `ModelRuntime` never
   * asks a provider for its headers. That is what "never enters logs, traces,
   * errors, manifests or persisted configuration" means structurally rather
   * than as a promise: there is no path from this method's return value back
   * to any of those places, because this method returns to nowhere but
   * `fetch`.
   */
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      ...(this.appUrl !== undefined ? { "HTTP-Referer": this.appUrl } : {}),
      ...(this.appName !== undefined ? { "X-Title": this.appName } : {}),
    };
  }
}

// ── Request translation ─────────────────────────────────────────

/**
 * OpenRouter's OpenAI-compatible request body.
 *
 * Routing and fallback are read only from `request.fallbackModels` and
 * `request.providerRouting` — fields `ModelRuntime` populates solely from the
 * resolved `ModelProfile`, never from anything an agent supplied per call. A
 * compromised agent cannot reach these fields at all; the request it can
 * shape is `AgentModelRequest`, which has no routing field to poison.
 */
function buildBody(request: ModelRequest): Record<string, unknown> {
  const routing = request.providerRouting;

  return {
    model: request.model,
    // OpenRouter tries this list in order when the primary model is
    // unavailable. Present only when the profile explicitly configured
    // fallbacks — an empty list is never sent, so OpenRouter's own default
    // routing behaviour is never invoked implicitly.
    ...(request.fallbackModels.length > 0
      ? { models: [request.model, ...request.fallbackModels] }
      : {}),
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "designflow_structured_output",
        strict: true,
        schema: request.responseSchema,
      },
    },
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined
      ? { max_tokens: request.maxOutputTokens }
      : {}),
    ...(routing !== undefined
      ? {
          provider: {
            ...(routing.order !== undefined ? { order: routing.order } : {}),
            ...(routing.allowFallbacks !== undefined
              ? { allow_fallbacks: routing.allowFallbacks }
              : {}),
            ...(routing.dataCollection !== undefined
              ? { data_collection: routing.dataCollection }
              : {}),
          },
        }
      : {}),
  };
}

// ── Response translation and error normalisation ────────────────

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DesignFlowError(
      "ERR_MODEL_RESPONSE_INVALID",
      "The provider returned a response that was not valid JSON.",
    );
  }
}

/**
 * The model's structured answer, as `unknown`.
 *
 * Requested via `response_format: json_schema`, which — for models that
 * honour it — makes `choices[0].message.content` a JSON string rather than
 * prose. Parsed here and handed back as `unknown`; whether it satisfies the
 * schema the *caller* actually cares about is re-checked independently with
 * Zod one layer up, never trusted on the strength of this parse alone.
 */
function extractStructuredOutput(body: unknown): unknown {
  const content = firstChoiceContent(body);

  if (content === undefined || content.trim().length === 0) {
    throw new DesignFlowError(
      "ERR_MODEL_OUTPUT_EMPTY",
      "The model returned no content.",
    );
  }

  const finishReason = firstChoiceFinishReason(body);
  if (finishReason === "length" || finishReason === "max_tokens") {
    throw new DesignFlowError(
      "ERR_MODEL_OUTPUT_TRUNCATED",
      "The model output reached its configured limit before producing valid JSON.",
    );
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new DesignFlowError(
      "ERR_MODEL_OUTPUT_JSON_INVALID",
      "The model's structured output was not valid JSON.",
    );
  }
}

function firstChoiceFinishReason(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return undefined;
  const reason = (first as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : undefined;
}

function firstChoiceContent(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;

  const [first] = choices as readonly unknown[];
  if (typeof first !== "object" || first === null) return undefined;

  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;

  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : undefined;
}

function readOptionalString(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readUsage(
  body: unknown,
): { inputTokens?: number; outputTokens?: number; totalTokens?: number; cost?: number } | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const usage = (body as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return undefined;

  const record = usage as Record<string, unknown>;
  const promptTokens = readOptionalNumber(record, "prompt_tokens");
  const completionTokens = readOptionalNumber(record, "completion_tokens");
  const totalTokens = readOptionalNumber(record, "total_tokens");
  const cost = readOptionalNumber(record, "cost");

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined &&
    cost === undefined
  ) {
    return undefined;
  }

  return {
    ...(promptTokens !== undefined ? { inputTokens: promptTokens } : {}),
    ...(completionTokens !== undefined ? { outputTokens: completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens: totalTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * An HTTP failure, translated to a stable code.
 *
 * The body is drained but never read into the thrown error — OpenRouter's own
 * error payload is untrusted the same way a successful one is, and the
 * classification comes from the status code alone. Draining rather than
 * ignoring the stream is just hygiene: an unread response body left dangling
 * on a rejected request is a minor resource leak across many failed calls.
 */
async function errorFor(response: Response): Promise<Error> {
  await response.text().catch(() => "");

  if (response.status === 401 || response.status === 403) {
    return new DesignFlowError(
      "ERR_MODEL_AUTHENTICATION",
      "The provider rejected the configured credential.",
    );
  }

  if (response.status === 429) {
    return new DesignFlowError(
      "ERR_MODEL_RATE_LIMITED",
      "The provider is rate-limiting requests.",
    );
  }

  if (response.status === 400) {
    return new DesignFlowError(
      "ERR_MODEL_SCHEMA_UNSUPPORTED",
      "The provider rejected the requested structured-output schema.",
    );
  }

  if (response.status === 404) {
    return new DesignFlowError(
      "ERR_MODEL_UNAVAILABLE",
      "The requested model is not available.",
    );
  }

  // Everything else — 5xx, an unexpected status — is a plain error rather
  // than a `DesignFlowError` carrying one of the recognised model codes.
  // `ModelRuntime` normalises anything it does not recognise to
  // `ERR_MODEL_PROVIDER_FAILED`, which is exactly the right classification
  // for "the provider is having a bad day" without this adapter having to
  // enumerate every 5xx status individually.
  return new Error(`OpenRouter responded with status ${response.status}.`);
}

const UNSUPPORTED_SCHEMA_KEYWORDS = ["oneOf", "anyOf", "allOf", "not", "if", "then", "else", "const"] as const;

/** Validates the strict JSON-schema subset used by OpenRouter before a call. */
export function openRouterResponseSchemaIssues(schema: JsonSchemaObject): readonly string[] {
  const issues: string[] = [];
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > 32) { issues.push("schema nesting exceeds the supported bound"); return; }
    if (typeof value !== "object" || value === null || Array.isArray(value)) { issues.push(`${path}: schema node must be an object`); return; }
    const node = value as Record<string, unknown>;
    for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) if (keyword in node) issues.push(`${path}: ${keyword} is unsupported`);
    if (node.type === "object") {
      const properties = node.properties;
      if (properties !== undefined && (typeof properties !== "object" || properties === null || Array.isArray(properties))) issues.push(`${path}: properties must be an object`);
      if (properties !== undefined && node.additionalProperties !== false) issues.push(`${path}: additionalProperties must be false`);
      if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
        const propertyNames = Object.keys(properties as Record<string, unknown>);
        const required = Array.isArray(node.required) ? node.required.filter((item): item is string => typeof item === "string") : [];
        for (const name of propertyNames) if (!required.includes(name)) issues.push(`${path}: ${name} must be required`);
        for (const [name, child] of Object.entries(properties as Record<string, unknown>)) visit(child, `${path}.${name}`, depth + 1);
      }
    }
    if (node.items !== undefined) visit(node.items, `${path}.items`, depth + 1);
  };
  visit(schema, "$", 0);
  return [...new Set(issues)].slice(0, 32);
}
