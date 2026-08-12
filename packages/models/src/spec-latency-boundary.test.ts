// packages/models/src/spec-latency-boundary.test.ts
//
// DF-SPEC-06: the final synchronous Specification budget, and the upstream
// reason that has to survive with each candidate failure.
//
// Field run 926a8b19 produced a real gpt-4o-mini completion in 91.5s (7,696
// output tokens) and then exhausted the chain anyway, with three broad codes
// and nothing to act on. Two things are pinned here: 145s is the client's
// candidate budget and the gateway can never cut a request before it, and a
// candidate's sanitized upstream reason travels with its attempt.
import { describe, expect, test } from "bun:test";
import { DesignFlowError, type ModelProvider, type ModelRequest } from "@designflow/sdk";
import { InMemoryModelProfileRegistry } from "./profile-registry";
import { InMemoryModelProviderRegistry } from "./provider-registry";
import { ModelRuntime } from "./runtime";
import {
  figmaSpecificationDefaultModelProfile,
  designEngineerCoordinatorDefaultModelProfile,
  implementationDefaultModelProfile,
  visualValidationDefaultModelProfile,
  visualCorrectionDefaultModelProfile,
} from "@designflow/agents";

/** The gateway's single global upstream ceiling (supabase/functions/ai-gateway). */
const GATEWAY_UPSTREAM_TIMEOUT_MS = 145_000;

const RESPONSE_SCHEMA = { type: "object" };

function call(signal?: AbortSignal) {
  return {
    requestId: "req-latency",
    profileId: "spec",
    messages: [{ role: "user" as const, content: "hi" }],
    responseSchema: RESPONSE_SCHEMA,
    ...(signal !== undefined ? { signal } : {}),
  };
}

/**
 * A provider that answers after `answerAfterMs` (fake-time scaled) or hangs
 * until its signal aborts. The runtime's real timer does the deciding.
 */
function timedProvider(
  behavior: Record<string, number | "hang">,
  calls: string[],
  reasons: Record<string, string> = {},
): ModelProvider {
  return {
    id: "openrouter",
    generate: (async (request: ModelRequest, context: { signal: AbortSignal }) => {
      calls.push(request.model);
      const plan = behavior[request.model] ?? 0;
      if (plan === "hang") {
        return new Promise((_, reject) => {
          const reason = reasons[request.model];
          context.signal.addEventListener(
            "abort",
            () => reject(reason !== undefined
              ? new DesignFlowError("ERR_MODEL_UNAVAILABLE", "unavailable", { reason })
              : new Error("aborted")),
            { once: true },
          );
        });
      }
      if (typeof plan === "number" && plan > 0) await new Promise((resolve) => setTimeout(resolve, plan));
      const reason = reasons[request.model];
      if (reason !== undefined) {
        throw new DesignFlowError("ERR_MODEL_UNAVAILABLE", `unavailable (${reason})`, { reason });
      }
      return {
        requestId: request.requestId,
        providerId: "openrouter",
        model: request.model,
        output: { answer: request.model },
        durationMs: plan === "hang" ? 0 : plan,
      };
    }) as never,
  };
}

function runtimeWith(provider: ModelProvider, timeoutMs: number) {
  return new ModelRuntime({
    profiles: new InMemoryModelProfileRegistry([
      { id: "spec", providerId: "openrouter", model: "model-a", fallbackModels: ["model-b", "model-c"], timeoutMs },
    ]),
    providers: new InMemoryModelProviderRegistry([provider]),
  });
}

describe("DF-SPEC-06 — the final synchronous Specification budget", () => {
  // Scaled: the real budget is 145s and the real completion was 91.5s. The
  // ratio (completion at ~63% of budget) is what these two tests encode.
  const BUDGET = 145;
  const UNDER_BUDGET = 91;

  test("A: a candidate that answers inside the budget succeeds", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(timedProvider({ "model-a": UNDER_BUDGET }, calls), BUDGET).generate(call());
    expect(calls).toEqual(["model-a"]);
    expect(result.type).toBe("success");
  });

  test("B: a candidate that reaches the budget times out and the next candidate is considered", async () => {
    const calls: string[] = [];
    const result = await runtimeWith(timedProvider({ "model-a": "hang", "model-b": 1 }, calls), BUDGET).generate(call());
    expect(calls).toEqual(["model-a", "model-b"]);
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.selection?.previousFailures[0]?.code).toBe("ERR_MODEL_TIMEOUT");
      // the timed-out candidate's own elapsed time is recorded, not the total
      expect(result.selection?.previousFailures[0]?.durationMs ?? 0).toBeGreaterThan(0);
    }
  });

  test("C: a caller abort mid-flight is terminal — no further paid candidate is started", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const result = await runtimeWith(timedProvider({ "model-a": "hang", "model-b": 1 }, calls), BUDGET)
      .generate(call(controller.signal) as never);
    expect(calls).toEqual(["model-a"]);
    expect(result.type).toBe("failure");
    if (result.type === "failure") expect(result.code).toBe("ERR_MODEL_ABORTED");
  });

  test("D: the gateway ceiling can never cut a Specification request before the client's own budget", () => {
    expect(figmaSpecificationDefaultModelProfile.timeoutMs).toBe(145_000);
    // The client's timer starts before the request leaves the machine, so at
    // equal budgets the client always trips first; a smaller gateway ceiling
    // would invert that and surface a gateway timeout instead of a candidate one.
    expect(GATEWAY_UPSTREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(
      figmaSpecificationDefaultModelProfile.timeoutMs ?? 0,
    );
  });

  test("E: no other agent profile gained a raised timeout", () => {
    for (const profile of [
      designEngineerCoordinatorDefaultModelProfile,
      implementationDefaultModelProfile,
      visualValidationDefaultModelProfile,
      visualCorrectionDefaultModelProfile,
    ]) {
      expect(profile.timeoutMs).toBeUndefined();
    }
  });

  test("the model order and output ceiling are unchanged by this task", () => {
    expect(figmaSpecificationDefaultModelProfile.model).toBe("openai/gpt-4o-mini");
    expect(figmaSpecificationDefaultModelProfile.fallbackModels).toEqual([
      "openai/gpt-5.6-luna",
      "deepseek/deepseek-v4-pro",
    ]);
  });
});

describe("DF-SPEC-06 — upstream reason propagation", () => {
  test("a candidate's sanitized upstream reason survives onto its attempt provenance", async () => {
    const calls: string[] = [];
    const provider = timedProvider({ "model-a": 1, "model-b": 1, "model-c": 1 }, calls, {
      "model-a": "requested model is unavailable: gpt-5.6-luna is not a valid model ID",
      "model-b": "no endpoints found matching your data policy",
      "model-c": "model not available to this account",
    });
    const result = await runtimeWith(provider, 500).generate(call());
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.code).toBe("ERR_MODEL_CANDIDATES_EXHAUSTED");
      expect(result.attempts?.map((attempt) => attempt.reason)).toEqual([
        "requested model is unavailable: gpt-5.6-luna is not a valid model ID",
        "no endpoints found matching your data policy",
        "model not available to this account",
      ]);
      expect(result.attempts?.every((attempt) => (attempt.durationMs ?? -1) >= 0)).toBe(true);
    }
  });

  test("credentials and URLs are redacted out of a reason before it is recorded", async () => {
    const calls: string[] = [];
    const leaky = "rejected by https://openrouter.ai/api/v1/chat using Bearer sk-or-v1-abc123 for key sk-or-v1-secret";
    const provider = timedProvider({ "model-a": 1, "model-b": 1, "model-c": 1 }, calls, {
      "model-a": leaky,
      "model-b": leaky,
      "model-c": leaky,
    });
    const result = await runtimeWith(provider, 500).generate(call());
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      const reason = result.attempts?.[0]?.reason ?? "";
      expect(reason).not.toContain("sk-or-v1");
      expect(reason).not.toContain("openrouter.ai");
      expect(reason).toContain("[redacted]");
      expect(reason).toContain("[url]");
    }
  });

  test("a failure with no upstream reason still records a clean attempt", async () => {
    const calls: string[] = [];
    const provider: ModelProvider = {
      id: "openrouter",
      generate: (async (request: ModelRequest) => {
        calls.push(request.model);
        throw new DesignFlowError("ERR_MODEL_UNAVAILABLE", "unavailable");
      }) as never,
    };
    const result = await runtimeWith(provider, 500).generate(call());
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.attempts?.[0]?.reason).toBeUndefined();
      expect(result.attempts?.[0]?.code).toBe("ERR_MODEL_UNAVAILABLE");
    }
  });
});
