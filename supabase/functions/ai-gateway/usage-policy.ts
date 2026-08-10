export const LAUNCH_USAGE_POLICY = Object.freeze({
  requestsPerMinute: 20,
  requestsPerDay: 200,
  requestsPerMonth: 3_000,
  tokensPerDay: 2_000_000,
  tokensPerMonth: 20_000_000,
  costUsdPerDay: 1,
  costUsdPerMonth: 5,
  globalCostUsdPerDay: 10,
  globalCostUsdPerMonth: 100,
  reservationTtlSeconds: 180,
});

/**
 * A deliberately conservative reservation for the current bounded gateway
 * contract. It covers a worst-case request body at roughly one byte per token
 * plus the 32k output ceiling, with margin below the global policy limits.
 */
export const RESERVED_COST_USD = 0.1;
export const MAX_RESERVED_TOKENS = 1_000_000;

export interface UsageBudgetSnapshot {
  readonly userRequestsPerMinute: number;
  readonly userRequestsPerDay: number;
  readonly userRequestsPerMonth: number;
  readonly userTokensPerDay: number;
  readonly userTokensPerMonth: number;
  readonly userCostUsdPerDay: number;
  readonly userCostUsdPerMonth: number;
  readonly globalCostUsdPerDay: number;
  readonly globalCostUsdPerMonth: number;
}
export type UsagePolicyRejection =
  | { readonly code: "ERR_MODEL_RATE_LIMIT"; readonly message: string; readonly retryAfterSeconds: number }
  | { readonly code: "ERR_MODEL_QUOTA_EXCEEDED"; readonly message: string; readonly retryAfterSeconds: number }
  | { readonly code: "ERR_MODEL_SERVICE_UNAVAILABLE"; readonly message: string; readonly retryAfterSeconds?: number };

export type UsagePolicyDecision = { readonly allowed: true } | { readonly allowed: false; readonly rejection: UsagePolicyRejection };

/**
 * Pure mirror of the checks enforced by the versioned Postgres reservation
 * function. Keeping this small deterministic seam makes the launch policy
 * testable without requiring Docker or a live Supabase database.
 */
export function evaluateUsagePolicy(
  snapshot: UsageBudgetSnapshot,
  reservationCostUsd: number,
  reservationTokens: number,
): UsagePolicyDecision {
  if (snapshot.userRequestsPerMinute + 1 > LAUNCH_USAGE_POLICY.requestsPerMinute) {
    return { allowed: false, rejection: { code: "ERR_MODEL_RATE_LIMIT", message: "the DesignFlow request rate limit was reached", retryAfterSeconds: 60 } };
  }
  if (snapshot.userRequestsPerDay + 1 > LAUNCH_USAGE_POLICY.requestsPerDay || snapshot.userRequestsPerMonth + 1 > LAUNCH_USAGE_POLICY.requestsPerMonth) {
    return { allowed: false, rejection: { code: "ERR_MODEL_QUOTA_EXCEEDED", message: "the DesignFlow request quota was reached", retryAfterSeconds: 86_400 } };
  }
  if (snapshot.userTokensPerDay + reservationTokens > LAUNCH_USAGE_POLICY.tokensPerDay || snapshot.userTokensPerMonth + reservationTokens > LAUNCH_USAGE_POLICY.tokensPerMonth) {
    return { allowed: false, rejection: { code: "ERR_MODEL_QUOTA_EXCEEDED", message: "the DesignFlow token quota was reached", retryAfterSeconds: 86_400 } };
  }
  if (snapshot.userCostUsdPerDay + reservationCostUsd > LAUNCH_USAGE_POLICY.costUsdPerDay || snapshot.userCostUsdPerMonth + reservationCostUsd > LAUNCH_USAGE_POLICY.costUsdPerMonth) {
    return { allowed: false, rejection: { code: "ERR_MODEL_QUOTA_EXCEEDED", message: "the DesignFlow AI cost quota was reached", retryAfterSeconds: 86_400 } };
  }
  if (snapshot.globalCostUsdPerDay + reservationCostUsd > LAUNCH_USAGE_POLICY.globalCostUsdPerDay || snapshot.globalCostUsdPerMonth + reservationCostUsd > LAUNCH_USAGE_POLICY.globalCostUsdPerMonth) {
    return { allowed: false, rejection: { code: "ERR_MODEL_SERVICE_UNAVAILABLE", message: "managed AI service protection is active", retryAfterSeconds: 3_600 } };
  }
  return { allowed: true };
}
