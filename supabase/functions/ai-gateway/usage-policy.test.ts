import { describe, expect, test } from "bun:test";
import {
  evaluateUsagePolicy,
  LAUNCH_USAGE_POLICY,
  RESERVED_COST_USD,
  type UsageBudgetSnapshot,
} from "./usage-policy";

const ZERO: UsageBudgetSnapshot = {
  userRequestsPerMinute: 0,
  userRequestsPerDay: 0,
  userRequestsPerMonth: 0,
  userTokensPerDay: 0,
  userTokensPerMonth: 0,
  userCostUsdPerDay: 0,
  userCostUsdPerMonth: 0,
  globalCostUsdPerDay: 0,
  globalCostUsdPerMonth: 0,
};

describe("launch usage policy", () => {
  test("uses the conservative launch limits", () => {
    expect(LAUNCH_USAGE_POLICY).toEqual({
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
    expect(RESERVED_COST_USD).toBe(0.1);
  });

  test("allows a request under every limit", () => {
    expect(evaluateUsagePolicy(ZERO, RESERVED_COST_USD, 100)).toEqual({ allowed: true });
  });

  test("rejects the minute request limit", () => {
    const result = evaluateUsagePolicy({ ...ZERO, userRequestsPerMinute: 20 }, RESERVED_COST_USD, 1);
    expect(result).toMatchObject({ allowed: false, rejection: { code: "ERR_MODEL_RATE_LIMIT", retryAfterSeconds: 60 } });
  });

  test.each([
    ["daily request", { userRequestsPerDay: 200 }],
    ["monthly request", { userRequestsPerMonth: 3_000 }],
    ["daily tokens", { userTokensPerDay: 2_000_000 }],
    ["monthly tokens", { userTokensPerMonth: 20_000_000 }],
    ["daily user cost", { userCostUsdPerDay: 0.95 }],
    ["monthly user cost", { userCostUsdPerMonth: 4.95 }],
  ] as const)("rejects the %s quota", (_name, snapshot) => {
    const result = evaluateUsagePolicy({ ...ZERO, ...snapshot }, RESERVED_COST_USD, 100);
    expect(result).toMatchObject({ allowed: false, rejection: { code: "ERR_MODEL_QUOTA_EXCEEDED" } });
  });

  test.each([
    ["daily global cost", { globalCostUsdPerDay: 9.95 }],
    ["monthly global cost", { globalCostUsdPerMonth: 99.95 }],
  ] as const)("rejects the %s safeguard", (_name, snapshot) => {
    const result = evaluateUsagePolicy({ ...ZERO, ...snapshot }, RESERVED_COST_USD, 100);
    expect(result).toMatchObject({ allowed: false, rejection: { code: "ERR_MODEL_SERVICE_UNAVAILABLE" } });
  });

  test("concurrent reservations are evaluated as separate atomic admissions", async () => {
    let requests = 19;
    let admitted = 0;
    let chain = Promise.resolve();
    const reserve = async (): Promise<boolean> => {
      const result = await new Promise<boolean>((resolve) => {
        chain = chain.then(() => {
          const decision = evaluateUsagePolicy({ ...ZERO, userRequestsPerMinute: requests }, RESERVED_COST_USD, 100);
          if (decision.allowed) {
            requests += 1;
            admitted += 1;
          }
          resolve(decision.allowed);
        });
      });
      return result;
    };

    const results = await Promise.all(Array.from({ length: 3 }, () => reserve()));
    expect(results).toEqual([true, false, false]);
    expect(admitted).toBe(1);
  });

  test("expired reservations are excluded by the SQL cleanup contract", () => {
    expect(evaluateUsagePolicy({ ...ZERO, userRequestsPerMinute: 0 }, RESERVED_COST_USD, 100)).toEqual({ allowed: true });
  });
});
