export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const MAX_REQUEST_BYTES = 512 * 1024;
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_MESSAGES = 32;
export const MAX_MESSAGE_LENGTH = 64 * 1024;
export const MAX_FALLBACK_MODELS = 8;
export const MAX_PROFILE_ID_LENGTH = 160;
export const MAX_MODEL_LENGTH = 240;
export const MANAGED_MODEL = "openai/gpt-4o-mini";

/**
 * Production-managed model policy. Profile ids are the stable identity that
 * the existing model runtime already sends on every request; the client model
 * field is advisory and is replaced by this map for every known route.
 *
 * The five Design Engineer profiles are the launch policy. The remaining
 * shipped profiles are explicit compatibility routes so enabling the managed
 * provider does not turn existing non-Design-Engineer commands into an
 * arbitrary-model proxy or an accidental model-unavailable failure.
 */
export const MANAGED_MODEL_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  "design-engineer-coordinator-default": MANAGED_MODEL,
  "figma-specification-default": MANAGED_MODEL,
  "implementation-default": MANAGED_MODEL,
  "visual-validation-default": MANAGED_MODEL,
  "visual-correction-default": MANAGED_MODEL,
  "design-engineer-default": MANAGED_MODEL,
  "qa-reviewer-default": MANAGED_MODEL,
  "research-analyst-default": MANAGED_MODEL,
  "product-manager-default": MANAGED_MODEL,
});

export type GatewayErrorCode =
  | "ERR_MODEL_AUTHENTICATION"
  | "ERR_MODEL_RATE_LIMITED"
  | "ERR_MODEL_TIMEOUT"
  | "ERR_MODEL_UNAVAILABLE"
  | "ERR_MODEL_SCHEMA_UNSUPPORTED"
  | "ERR_MODEL_RESPONSE_INVALID"
  | "ERR_MODEL_OUTPUT_EMPTY"
  | "ERR_MODEL_OUTPUT_JSON_INVALID"
  | "ERR_MODEL_OUTPUT_TRUNCATED"
  | "ERR_MODEL_ROUTE_NOT_FOUND"
  | "ERR_MODEL_RATE_LIMIT"
  | "ERR_MODEL_QUOTA_EXCEEDED"
  | "ERR_MODEL_SERVICE_UNAVAILABLE"
  | "ERR_MODEL_PROVIDER_FAILED";

export interface GatewayMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

export interface GatewayProviderRouting {
  readonly order?: readonly string[];
  readonly allowFallbacks?: boolean;
  readonly dataCollection?: "allow" | "deny";
}

export interface GatewayRequest {
  readonly requestId: string;
  readonly profileId: string;
  readonly model: string;
  readonly messages: readonly GatewayMessage[];
  readonly responseSchema: Record<string, unknown>;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly fallbackModels: readonly string[];
  readonly providerRouting?: GatewayProviderRouting;
}

export interface GatewayUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cost?: number;
}

export interface GatewaySuccess {
  readonly requestId: string;
  /** The upstream provider that supplied the normalized response. */
  readonly providerId: "openrouter";
  readonly model: string;
  readonly output: unknown;
  readonly usage?: GatewayUsage;
  readonly durationMs: number;
  readonly providerRequestId?: string;
}

export interface GatewayErrorPayload {
  readonly error: {
    readonly code: GatewayErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly retryAfterSeconds?: number;
  };
}

export class GatewayFailure extends Error {
  public readonly code: GatewayErrorCode;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly retryAfterSeconds: number | undefined;

  public constructor(code: GatewayErrorCode, message: string, status = 502, retryable = false, retryAfterSeconds?: number) {
    super(message);
    this.name = "GatewayFailure";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ParsedGatewayRequest =
  | { readonly ok: true; readonly value: GatewayRequest }
  | { readonly ok: false; readonly message: string };

export function parseGatewayRequest(value: unknown): ParsedGatewayRequest {
  if (!isRecord(value)) return { ok: false, message: "request must be an object" };
  if (!hasOnlyKeys(value, [
    "requestId",
    "profileId",
    "model",
    "messages",
    "responseSchema",
    "temperature",
    "maxOutputTokens",
    "fallbackModels",
    "providerRouting",
  ])) {
    return { ok: false, message: "request contains unsupported fields" };
  }

  const requestId = boundedString(value.requestId, 200);
  const profileId = boundedString(value.profileId, MAX_PROFILE_ID_LENGTH);
  const model = boundedString(value.model, MAX_MODEL_LENGTH);
  if (requestId === undefined || profileId === undefined || model === undefined) {
    return { ok: false, message: "requestId, profileId, and model must be bounded strings" };
  }

  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > MAX_MESSAGES) {
    return { ok: false, message: "messages must contain between one and 32 items" };
  }
  const messages: GatewayMessage[] = [];
  for (const message of value.messages) {
    if (!isRecord(message) || !hasOnlyKeys(message, ["role", "content"])) {
      return { ok: false, message: "messages contain an unsupported shape" };
    }
    const role = message.role;
    const content = boundedString(message.content, MAX_MESSAGE_LENGTH);
    if ((role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") || content === undefined) {
      return { ok: false, message: "messages contain an invalid role or content" };
    }
    messages.push({ role, content });
  }

  if (!isRecord(value.responseSchema)) {
    return { ok: false, message: "responseSchema must be a JSON object" };
  }

  const temperature = optionalNumber(value.temperature, 0, 2);
  const maxOutputTokens = optionalInteger(value.maxOutputTokens, 1, 32_000);
  if (value.temperature !== undefined && temperature === undefined) {
    return { ok: false, message: "temperature is outside the supported range" };
  }
  if (value.maxOutputTokens !== undefined && maxOutputTokens === undefined) {
    return { ok: false, message: "maxOutputTokens is outside the supported range" };
  }

  const fallbackModels = readStringArray(value.fallbackModels, MAX_FALLBACK_MODELS, MAX_MODEL_LENGTH);
  if (fallbackModels === undefined) return { ok: false, message: "fallbackModels is invalid" };

  const providerRouting = parseProviderRouting(value.providerRouting);
  if (value.providerRouting !== undefined && providerRouting === undefined) {
    return { ok: false, message: "providerRouting is invalid" };
  }

  return {
    ok: true,
    value: {
      requestId,
      profileId,
      model,
      messages,
      responseSchema: { ...value.responseSchema },
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      fallbackModels,
      ...(providerRouting !== undefined ? { providerRouting } : {}),
    },
  };
}

export function buildOpenRouterBody(request: GatewayRequest): Record<string, unknown> {
  const routing = request.providerRouting;
  return {
    model: request.model,
    ...(request.fallbackModels.length > 0
      ? { models: [request.model, ...request.fallbackModels] }
      : {}),
    messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "designflow_structured_output",
        strict: true,
        schema: request.responseSchema,
      },
    },
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
    ...(routing !== undefined
      ? {
          provider: {
            ...(routing.order !== undefined ? { order: routing.order } : {}),
            ...(routing.allowFallbacks !== undefined ? { allow_fallbacks: routing.allowFallbacks } : {}),
            ...(routing.dataCollection !== undefined ? { data_collection: routing.dataCollection } : {}),
          },
        }
      : {}),
  };
}

/**
 * Applies the server-owned managed route. Client fallback/provider hints are
 * deliberately discarded: Phase 5 has one configured model and no fallback
 * chain, so an authenticated caller cannot use the gateway to select a model
 * or provider outside this allowlist.
 */
export function routeManagedRequest(request: GatewayRequest): GatewayRequest | GatewayFailure {
  const model = MANAGED_MODEL_ROUTES[request.profileId];
  if (model === undefined) {
    return new GatewayFailure("ERR_MODEL_ROUTE_NOT_FOUND", "no managed model route is configured for this profile", 400);
  }

  return {
    requestId: request.requestId,
    profileId: request.profileId,
    model,
    messages: request.messages,
    responseSchema: request.responseSchema,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
    fallbackModels: [],
  };
}

export function normalizeOpenRouterResponse(
  value: unknown,
  request: GatewayRequest,
  durationMs: number,
): GatewaySuccess {
  if (!isRecord(value)) throw new GatewayFailure("ERR_MODEL_RESPONSE_INVALID", "provider response was not an object");
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new GatewayFailure("ERR_MODEL_RESPONSE_INVALID", "provider response did not contain a choice");
  }
  const message = choices[0].message;
  if (!isRecord(message) || typeof message.content !== "string" || message.content.trim().length === 0) {
    throw new GatewayFailure("ERR_MODEL_OUTPUT_EMPTY", "provider returned no model content");
  }
  const finishReason = choices[0].finish_reason;
  if (finishReason === "length" || finishReason === "max_tokens") {
    throw new GatewayFailure("ERR_MODEL_OUTPUT_TRUNCATED", "provider output reached its configured limit");
  }

  let output: unknown;
  try {
    output = JSON.parse(message.content) as unknown;
  } catch {
    throw new GatewayFailure("ERR_MODEL_OUTPUT_JSON_INVALID", "provider output was not valid JSON");
  }

  const usage = readUsage(value.usage);
  const providerRequestId = typeof value.id === "string" && value.id.length > 0 ? value.id : undefined;
  const model = typeof value.model === "string" && value.model.length > 0 ? value.model : request.model;
  return {
    requestId: request.requestId,
    providerId: "openrouter",
    model,
    output,
    ...(usage !== undefined ? { usage } : {}),
    durationMs: Math.max(0, durationMs),
    ...(providerRequestId !== undefined ? { providerRequestId } : {}),
  };
}

export function classifyUpstreamStatus(status: number): GatewayFailure {
  if (status === 401 || status === 403) return new GatewayFailure("ERR_MODEL_AUTHENTICATION", "upstream provider rejected the gateway credential", 502);
  if (status === 429) return new GatewayFailure("ERR_MODEL_RATE_LIMITED", "upstream provider rate-limited the gateway", 429, true);
  if (status === 400) return new GatewayFailure("ERR_MODEL_SCHEMA_UNSUPPORTED", "upstream provider rejected the requested schema", 400);
  if (status === 404) return new GatewayFailure("ERR_MODEL_UNAVAILABLE", "requested model is unavailable", 404, true);
  if (status === 408 || status === 504) return new GatewayFailure("ERR_MODEL_TIMEOUT", "upstream provider timed out", 504, true);
  return new GatewayFailure("ERR_MODEL_PROVIDER_FAILED", "upstream provider request failed", 502, true);
}

export function errorPayload(error: GatewayFailure): GatewayErrorPayload {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  };
}

function parseProviderRouting(value: unknown): GatewayProviderRouting | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasOnlyKeys(value, ["order", "allowFallbacks", "dataCollection"])) return undefined;
  const order = value.order === undefined ? undefined : readStringArray(value.order, MAX_FALLBACK_MODELS, MAX_MODEL_LENGTH);
  if (value.order !== undefined && order === undefined) return undefined;
  const allowFallbacks = value.allowFallbacks === undefined ? undefined : value.allowFallbacks;
  const dataCollection = value.dataCollection === undefined ? undefined : value.dataCollection;
  if (allowFallbacks !== undefined && typeof allowFallbacks !== "boolean") return undefined;
  if (dataCollection !== undefined && dataCollection !== "allow" && dataCollection !== "deny") return undefined;
  return {
    ...(order !== undefined ? { order } : {}),
    ...(allowFallbacks !== undefined ? { allowFallbacks } : {}),
    ...(dataCollection !== undefined ? { dataCollection } : {}),
  };
}

function readUsage(value: unknown): GatewayUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = nonNegativeNumber(value.prompt_tokens);
  const outputTokens = nonNegativeNumber(value.completion_tokens);
  const totalTokens = nonNegativeNumber(value.total_tokens);
  const cost = nonNegativeNumber(value.cost);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && cost === undefined) return undefined;
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

function readStringArray(value: unknown, maxLength: number, itemLength: number): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maxLength) return undefined;
  const values = value.map((item) => boundedString(item, itemLength));
  return values.every((item): item is string => item !== undefined) ? values : undefined;
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
