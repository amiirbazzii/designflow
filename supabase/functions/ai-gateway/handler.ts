import {
  classifyUpstreamStatus,
  errorPayload,
  GatewayFailure,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  OPENROUTER_ENDPOINT,
  normalizeOpenRouterResponse,
  parseGatewayRequest,
  buildOpenRouterBody,
  type GatewayErrorPayload,
} from "./contract.ts";

export interface GatewayHandlerOptions {
  readonly openRouterApiKey: string | undefined;
  /** Public Supabase Auth endpoint configuration; never a service-role key. */
  readonly supabaseUrl?: string;
  readonly supabasePublishableKey?: string;
  readonly allowLocalDev?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly authFetchImpl?: typeof fetch;
  readonly now?: () => number;
  /** Test seam; production defaults to the bounded 30-second ceiling. */
  readonly timeoutMs?: number;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const UPSTREAM_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 5_000;

/**
 * Pure Edge Function handler. `index.ts` is the only module that reads Deno
 * secrets; this function receives the secret as an opaque server-side value so
 * it can be exercised with deterministic HTTP doubles.
 */
export async function handleAiGatewayRequest(
  request: Request,
  options: GatewayHandlerOptions,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: { code: "ERR_MODEL_PROVIDER_FAILED", message: "method not allowed", retryable: false } }, 405);
  const bearer = readBearerToken(request);
  if (bearer === undefined) return json({ error: { code: "ERR_MODEL_AUTHENTICATION", message: "a bearer session token is required", retryable: false } }, 401);
  if (!(options.allowLocalDev === true && bearer === "local-test-token")) {
    const authenticated = await authenticateSupabaseUser(bearer, request, options);
    if (!authenticated) return json({ error: { code: "ERR_MODEL_AUTHENTICATION", message: "the DesignFlow session is not valid", retryable: false } }, 401);
  }

  const bodyText = await readBoundedText(request);
  if (bodyText === undefined) return json({ error: { code: "ERR_MODEL_RESPONSE_INVALID", message: "request body is too large", retryable: false } }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
  } catch {
    return json({ error: { code: "ERR_MODEL_RESPONSE_INVALID", message: "request body is invalid JSON", retryable: false } }, 400);
  }

  const parsed = parseGatewayRequest(raw);
  if (!parsed.ok) return json({ error: { code: "ERR_MODEL_RESPONSE_INVALID", message: "request shape is invalid", retryable: false } }, 400);
  if (options.openRouterApiKey === undefined || options.openRouterApiKey.trim().length === 0) {
    return json({ error: { code: "ERR_MODEL_PROVIDER_FAILED", message: "managed provider is unavailable", retryable: true } }, 503);
  }

  const startedAt = (options.now ?? Date.now)();
  const fetchImpl = options.fetchImpl ?? fetch;
  const upstreamController = new AbortController();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS, 1), UPSTREAM_TIMEOUT_MS);
  const timeout = setTimeout(() => upstreamController.abort(), timeoutMs);
  const disconnect = () => upstreamController.abort();
  request.signal.addEventListener("abort", disconnect, { once: true });
  let upstream: Response;
  try {
    upstream = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildOpenRouterBody(parsed.value)),
      signal: upstreamController.signal,
    });
  } catch {
    const timedOut = upstreamController.signal.aborted;
    return timedOut
      ? json({ error: { code: "ERR_MODEL_TIMEOUT", message: "managed provider timed out", retryable: true } }, 504)
      : json({ error: { code: "ERR_MODEL_PROVIDER_FAILED", message: "managed provider is unavailable", retryable: true } }, 502);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", disconnect);
  }

  const upstreamText = await readBoundedText(upstream);
  if (upstreamText === undefined) return json({ error: { code: "ERR_MODEL_RESPONSE_INVALID", message: "provider response is too large", retryable: false } }, 502);

  if (!upstream.ok) {
    const failure = classifyUpstreamStatus(upstream.status);
    return json(errorPayload(failure), failure.status);
  }

  let upstreamBody: unknown;
  try {
    upstreamBody = JSON.parse(upstreamText) as unknown;
  } catch {
    return json({ error: { code: "ERR_MODEL_RESPONSE_INVALID", message: "provider response is invalid", retryable: false } }, 502);
  }

  try {
    return json(normalizeOpenRouterResponse(upstreamBody, parsed.value, Math.max(0, (options.now ?? Date.now)() - startedAt)), 200);
  } catch (error) {
    const failure = error instanceof GatewayFailure
      ? error
      : new GatewayFailure("ERR_MODEL_RESPONSE_INVALID", "provider response is invalid");
    return json(errorPayload(failure), failure.status);
  }
}

function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length === 0 ? undefined : token;
}

async function authenticateSupabaseUser(
  token: string,
  request: Request,
  options: GatewayHandlerOptions,
): Promise<boolean> {
  if (options.supabaseUrl === undefined || options.supabasePublishableKey === undefined) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  request.signal.addEventListener("abort", forwardAbort, { once: true });
  try {
    const fetchImpl = options.authFetchImpl ?? fetch;
    const response = await fetchImpl(`${options.supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: options.supabasePublishableKey,
      },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = await readBoundedText(response);
    if (body === undefined || body.length === 0) return false;
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed !== null && typeof (parsed as { id?: unknown }).id === "string";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", forwardAbort);
  }
}

async function readBoundedText(response: Request | Response): Promise<string | undefined> {
  const contentLength = response.headers.get("content-length");
  const limit = response instanceof Request ? MAX_REQUEST_BYTES : MAX_RESPONSE_BYTES;
  if (contentLength !== null && Number(contentLength) > limit) return undefined;
  const text = await response.text();
  return text.length <= limit ? text : undefined;
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

export type { GatewayErrorPayload };
