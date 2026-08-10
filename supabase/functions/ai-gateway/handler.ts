import {
  classifyUpstreamStatus,
  errorPayload,
  GatewayFailure,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  OPENROUTER_ENDPOINT,
  normalizeOpenRouterResponse,
  parseGatewayRequest,
  routeManagedRequest,
  buildOpenRouterBody,
  type GatewayErrorPayload,
} from "./contract.ts";
import {
  estimateReservedTokens,
  UsageLedgerUnavailableError,
  type UsageFinalizationInput,
  type UsageLedger,
} from "./usage.ts";

export interface GatewayHandlerOptions {
  readonly openRouterApiKey: string | undefined;
  /** Public Supabase Auth endpoint configuration; never a service-role key. */
  readonly supabaseUrl?: string;
  readonly supabasePublishableKey?: string;
  readonly usageLedger?: UsageLedger;
  readonly enabled?: boolean;
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
  let userId: string;
  if (!(options.allowLocalDev === true && bearer === "local-test-token")) {
    const authenticatedUserId = await authenticateSupabaseUser(bearer, request, options);
    if (authenticatedUserId === undefined) return json({ error: { code: "ERR_MODEL_AUTHENTICATION", message: "the DesignFlow session is not valid", retryable: false } }, 401);
    userId = authenticatedUserId;
  } else {
    userId = "local-test-user";
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
  const routed = routeManagedRequest(parsed.value);
  if (routed instanceof GatewayFailure) return json(errorPayload(routed), routed.status);
  if (options.enabled === false) return json(errorPayload(new GatewayFailure("ERR_MODEL_SERVICE_UNAVAILABLE", "managed AI service protection is active", 503, true, 3600)), 503);
  const usageLedger = options.usageLedger;
  if (usageLedger === undefined && !(options.allowLocalDev === true && bearer === "local-test-token")) {
    return json(errorPayload(new GatewayFailure("ERR_MODEL_SERVICE_UNAVAILABLE", "usage protection is unavailable", 503, true)), 503);
  }

  let reservation: { readonly requestId: string } | undefined;
  if (usageLedger !== undefined) {
    let decision;
    try {
      decision = await usageLedger.reserve({
        userId,
        profileId: routed.profileId,
        effectiveModel: routed.model,
        reservedTokens: estimateReservedTokens(bodyText, routed.maxOutputTokens),
      });
    } catch (error) {
      if (error instanceof UsageLedgerUnavailableError) {
        return json(errorPayload(new GatewayFailure("ERR_MODEL_SERVICE_UNAVAILABLE", "usage protection is unavailable", 503, true)), 503);
      }
      return json(errorPayload(new GatewayFailure("ERR_MODEL_SERVICE_UNAVAILABLE", "usage protection is unavailable", 503, true)), 503);
    }
    if (!decision.allowed) {
      return json(errorPayload(new GatewayFailure(decision.code, decision.message, decision.code === "ERR_MODEL_SERVICE_UNAVAILABLE" ? 503 : 429, true, decision.retryAfterSeconds)), decision.code === "ERR_MODEL_SERVICE_UNAVAILABLE" ? 503 : 429);
    }
    reservation = { requestId: decision.reservation.requestId };
  }
  if (options.openRouterApiKey === undefined || options.openRouterApiKey.trim().length === 0) {
    await finalizeUsage(usageLedger, reservation, { requestId: reservation?.requestId ?? "", status: "failed" });
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
      body: JSON.stringify(buildOpenRouterBody(routed)),
      signal: upstreamController.signal,
    });
  } catch {
    const timedOut = upstreamController.signal.aborted;
    await finalizeUsage(usageLedger, reservation, { requestId: reservation?.requestId ?? "", status: "failed" });
    return timedOut
      ? json({ error: { code: "ERR_MODEL_TIMEOUT", message: "managed provider timed out", retryable: true } }, 504)
      : json({ error: { code: "ERR_MODEL_PROVIDER_FAILED", message: "managed provider is unavailable", retryable: true } }, 502);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", disconnect);
  }

  const upstreamText = await readBoundedText(upstream);
  if (upstreamText === undefined) {
    await finalizeUsage(usageLedger, reservation, { requestId: reservation?.requestId ?? "", status: "failed" });
    return json({ error: { code: "ERR_MODEL_RESPONSE_INVALID", message: "provider response is too large", retryable: false } }, 502);
  }

  if (!upstream.ok) {
    const failure = classifyUpstreamStatus(upstream.status);
    await finalizeUsage(usageLedger, reservation, { requestId: reservation?.requestId ?? "", status: "failed" });
    return json(errorPayload(failure), failure.status);
  }

  let upstreamBody: unknown;
  try {
    upstreamBody = JSON.parse(upstreamText) as unknown;
  } catch {
    await finalizeUsage(usageLedger, reservation, { requestId: reservation?.requestId ?? "", status: "failed" });
    return json({ error: { code: "ERR_MODEL_RESPONSE_INVALID", message: "provider response is invalid", retryable: false } }, 502);
  }

  try {
    const normalized = normalizeOpenRouterResponse(upstreamBody, routed, Math.max(0, (options.now ?? Date.now)() - startedAt));
    const finalized = await finalizeUsage(usageLedger, reservation, {
      requestId: reservation?.requestId ?? "",
      status: "succeeded",
      ...(normalized.usage?.inputTokens !== undefined ? { inputTokens: normalized.usage.inputTokens } : {}),
      ...(normalized.usage?.outputTokens !== undefined ? { outputTokens: normalized.usage.outputTokens } : {}),
      ...(normalized.usage?.totalTokens !== undefined ? { totalTokens: normalized.usage.totalTokens } : {}),
      ...(normalized.usage?.cost !== undefined ? { actualCostUsd: normalized.usage.cost } : {}),
    });
    if (!finalized) return json(errorPayload(new GatewayFailure("ERR_MODEL_SERVICE_UNAVAILABLE", "usage protection could not finalize the request", 503, true)), 503);
    return json(normalized, 200);
  } catch (error) {
    const failure = error instanceof GatewayFailure
      ? error
      : new GatewayFailure("ERR_MODEL_RESPONSE_INVALID", "provider response is invalid");
    await finalizeUsage(usageLedger, reservation, { requestId: reservation?.requestId ?? "", status: "failed" });
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
): Promise<string | undefined> {
  if (options.supabaseUrl === undefined || options.supabasePublishableKey === undefined) return undefined;

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
    if (!response.ok) return undefined;
    const body = await readBoundedText(response);
    if (body === undefined || body.length === 0) return undefined;
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed !== null && typeof (parsed as { id?: unknown }).id === "string"
      ? (parsed as { id: string }).id
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", forwardAbort);
  }
}

async function finalizeUsage(ledger: UsageLedger | undefined, reservation: { readonly requestId: string } | undefined, input: UsageFinalizationInput): Promise<boolean> {
  if (ledger === undefined || reservation === undefined) return true;
  try {
    await ledger.finalize({ ...input, requestId: reservation.requestId });
    return true;
  } catch {
    return false;
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
