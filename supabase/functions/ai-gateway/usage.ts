import {
  LAUNCH_USAGE_POLICY,
  MAX_RESERVED_TOKENS,
  RESERVED_COST_USD,
} from "./usage-policy.ts";

const MAX_USAGE_RESPONSE_BYTES = 64 * 1024;

export interface UsageReservationInput {
  readonly userId: string;
  readonly profileId: string;
  readonly effectiveModel: string;
  readonly reservedTokens: number;
}
export interface UsageReservation {
  readonly requestId: string;
  readonly reservedCostUsd: number;
  readonly reservedTokens: number;
}

export type UsageRejection = {
  readonly allowed: false;
  readonly code: "ERR_MODEL_RATE_LIMIT" | "ERR_MODEL_QUOTA_EXCEEDED" | "ERR_MODEL_SERVICE_UNAVAILABLE";
  readonly message: string;
  readonly retryAfterSeconds?: number;
};

export type UsageReservationResult = { readonly allowed: true; readonly reservation: UsageReservation } | UsageRejection;

export interface UsageFinalizationInput {
  readonly requestId: string;
  readonly status: "succeeded" | "failed";
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly actualCostUsd?: number;
}

export interface UsageLedger {
  reserve(input: UsageReservationInput): Promise<UsageReservationResult>;
  finalize(input: UsageFinalizationInput): Promise<void>;
}

export interface SupabaseUsageLedgerOptions {
  readonly supabaseUrl?: string;
  readonly serviceRoleKey?: string;
  readonly fetchImpl?: typeof fetch;
}

export class UsageLedgerUnavailableError extends Error {
  public constructor() {
    super("usage protection is unavailable");
    this.name = "UsageLedgerUnavailableError";
  }
}

/** Server-only PostgREST RPC adapter. The service-role key never enters request data or responses. */
export class SupabaseUsageLedger implements UsageLedger {
  private readonly endpoint: string;
  private readonly serviceRoleKey: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: Required<Pick<SupabaseUsageLedgerOptions, "supabaseUrl" | "serviceRoleKey">> & Pick<SupabaseUsageLedgerOptions, "fetchImpl">) {
    this.endpoint = `${options.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc`;
    this.serviceRoleKey = options.serviceRoleKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async reserve(input: UsageReservationInput): Promise<UsageReservationResult> {
    const response = await this.call("designflow_reserve_ai_usage", {
      p_request_id: crypto.randomUUID(),
      p_user_id: input.userId,
      p_profile_id: input.profileId,
      p_effective_model: input.effectiveModel,
      p_reserved_cost_usd: RESERVED_COST_USD,
      p_reserved_tokens: input.reservedTokens,
      p_requests_per_minute: LAUNCH_USAGE_POLICY.requestsPerMinute,
      p_requests_per_day: LAUNCH_USAGE_POLICY.requestsPerDay,
      p_requests_per_month: LAUNCH_USAGE_POLICY.requestsPerMonth,
      p_tokens_per_day: LAUNCH_USAGE_POLICY.tokensPerDay,
      p_tokens_per_month: LAUNCH_USAGE_POLICY.tokensPerMonth,
      p_cost_usd_per_day: LAUNCH_USAGE_POLICY.costUsdPerDay,
      p_cost_usd_per_month: LAUNCH_USAGE_POLICY.costUsdPerMonth,
      p_global_cost_usd_per_day: LAUNCH_USAGE_POLICY.globalCostUsdPerDay,
      p_global_cost_usd_per_month: LAUNCH_USAGE_POLICY.globalCostUsdPerMonth,
      p_reservation_ttl_seconds: LAUNCH_USAGE_POLICY.reservationTtlSeconds,
    });
    if (!isRecord(response)) throw new UsageLedgerUnavailableError();
    if (response.allowed === false) {
      const code = response.code;
      if (code !== "ERR_MODEL_RATE_LIMIT" && code !== "ERR_MODEL_QUOTA_EXCEEDED" && code !== "ERR_MODEL_SERVICE_UNAVAILABLE") {
        throw new UsageLedgerUnavailableError();
      }
      return {
        allowed: false,
        code,
        message: safeMessage(response.message),
        ...(boundedRetryAfter(response.retry_after_seconds) !== undefined ? { retryAfterSeconds: boundedRetryAfter(response.retry_after_seconds) } : {}),
      };
    }
    if (response.allowed !== true || typeof response.reservation_id !== "string") throw new UsageLedgerUnavailableError();
    return {
      allowed: true,
      reservation: {
        requestId: response.reservation_id,
        reservedCostUsd: RESERVED_COST_USD,
        reservedTokens: input.reservedTokens,
      },
    };
  }

  public async finalize(input: UsageFinalizationInput): Promise<void> {
    await this.call("designflow_finalize_ai_usage", {
      p_request_id: input.requestId,
      p_status: input.status,
      ...(input.inputTokens !== undefined ? { p_input_tokens: input.inputTokens } : {}),
      ...(input.outputTokens !== undefined ? { p_output_tokens: input.outputTokens } : {}),
      ...(input.totalTokens !== undefined ? { p_total_tokens: input.totalTokens } : {}),
      ...(input.actualCostUsd !== undefined ? { p_actual_cost_usd: input.actualCostUsd } : {}),
    });
  }

  private async call(name: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.serviceRoleKey}`,
          apikey: this.serviceRoleKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new UsageLedgerUnavailableError();
    }
    if (!response.ok) throw new UsageLedgerUnavailableError();
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_USAGE_RESPONSE_BYTES) throw new UsageLedgerUnavailableError();
    const text = await response.text();
    if (text.length > MAX_USAGE_RESPONSE_BYTES) throw new UsageLedgerUnavailableError();
    try {
      return text.length === 0 ? {} : JSON.parse(text) as unknown;
    } catch {
      throw new UsageLedgerUnavailableError();
    }
  }
}

export function createSupabaseUsageLedger(options: SupabaseUsageLedgerOptions): UsageLedger | undefined {
  const supabaseUrl = options.supabaseUrl?.trim();
  const serviceRoleKey = options.serviceRoleKey?.trim();
  if (supabaseUrl === undefined || supabaseUrl.length === 0 || serviceRoleKey === undefined || serviceRoleKey.length === 0) return undefined;
  return new SupabaseUsageLedger({ supabaseUrl, serviceRoleKey, ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}) });
}

export function estimateReservedTokens(requestBody: string, maxOutputTokens: number | undefined): number {
  const estimated = new TextEncoder().encode(requestBody).byteLength + (maxOutputTokens ?? 32_000);
  return Math.min(MAX_RESERVED_TOKENS, Math.max(1, estimated));
}

function safeMessage(value: unknown): string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : "managed AI usage protection rejected the request";
}

function boundedRetryAfter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 86_400 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
