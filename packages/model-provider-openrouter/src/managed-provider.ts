import {
  DesignFlowError,
  modelResponseSchema,
  type ModelProvider,
  type ModelProviderCapabilities,
  type ModelProviderContext,
  type ModelRequest,
  type ModelResponse,
} from "@designflow/sdk";
import { openRouterResponseSchemaIssues } from "./provider";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface ManagedGatewayProviderOptions {
  readonly endpoint: string;
  readonly sessionToken?: string | (() => string | undefined);
  readonly fetchImpl?: typeof fetch;
}

/** Client-side adapter; it accepts only a gateway session token, never an upstream key. */
export class ManagedGatewayProvider implements ModelProvider {
  public readonly id = "designflow-managed";

  private readonly endpoint: string;
  private readonly sessionToken: string | (() => string | undefined) | undefined;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: ManagedGatewayProviderOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.sessionToken = options.sessionToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public capabilities(_model: string): ModelProviderCapabilities {
    return { jsonMode: true, strictJsonSchema: true, toolCalling: false, maxOutputTokens: 32_000, responseSchemaIssues: openRouterResponseSchemaIssues };
  }

  public async generate(request: ModelRequest, context: ModelProviderContext): Promise<ModelResponse> {
    const sessionToken = this.readSessionToken();
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken !== undefined ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify(request),
      signal: context.signal,
    });
    const body = await readJsonBody(response);
    if (!response.ok) throw gatewayError(response.status, body);

    const parsed = modelResponseSchema.safeParse(body);
    if (!parsed.success) throw new DesignFlowError("ERR_MODEL_RESPONSE_INVALID", "The managed gateway returned an invalid model response.");
    if (parsed.data.requestId !== request.requestId) throw new DesignFlowError("ERR_MODEL_RESPONSE_INVALID", "The managed gateway returned a response for a different request.");
    return { ...parsed.data, providerId: this.id };
  }

  private readSessionToken(): string | undefined {
    const token = typeof this.sessionToken === "function" ? this.sessionToken() : this.sessionToken;
    return token === undefined || token.trim().length === 0 ? undefined : token;
  }
}

function normalizeEndpoint(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch {
    throw new DesignFlowError("ERR_MODEL_CONFIGURATION_INVALID", "The managed AI gateway endpoint is not a valid URL.");
  }
  const localHttp = parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new DesignFlowError("ERR_MODEL_CONFIGURATION_INVALID", "The managed AI gateway endpoint must use HTTPS (or local HTTP for development).");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new DesignFlowError("ERR_MODEL_RESPONSE_INVALID", "The managed gateway response exceeded the supported size.");
  try { return JSON.parse(text) as unknown; } catch {
    throw new DesignFlowError("ERR_MODEL_RESPONSE_INVALID", "The managed gateway returned invalid JSON.");
  }
}

function gatewayError(status: number, body: unknown): Error {
  const code = readGatewayCode(body);
  if (code === "ERR_MODEL_AUTHENTICATION" || status === 401 || status === 403) return new DesignFlowError("ERR_MODEL_AUTHENTICATION", "The managed AI gateway rejected the session.");
  if (code === "ERR_MODEL_RATE_LIMITED" || status === 429) return new DesignFlowError("ERR_MODEL_RATE_LIMITED", "The managed AI gateway is rate-limiting requests.");
  if (code === "ERR_MODEL_TIMEOUT" || status === 408 || status === 504) return new DesignFlowError("ERR_MODEL_TIMEOUT", "The managed AI gateway timed out.");
  if (code === "ERR_MODEL_UNAVAILABLE" || status === 404 || status >= 500) return new DesignFlowError("ERR_MODEL_UNAVAILABLE", "The managed AI gateway or requested model is unavailable.");
  if (code === "ERR_MODEL_SCHEMA_UNSUPPORTED" || status === 400) return new DesignFlowError("ERR_MODEL_SCHEMA_UNSUPPORTED", "The managed gateway rejected the requested output schema.");
  return new DesignFlowError("ERR_MODEL_PROVIDER_FAILED", "The managed AI gateway request failed.");
}

function readGatewayCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
