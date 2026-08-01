// packages/agents/src/model-service.test.ts
import { describe, expect, test } from "bun:test";
import type { ModelInvocationRequest, ModelInvoker, ModelResult } from "@designflow/sdk";
import {
  AgentScopedModelService,
  DEFAULT_MAX_MODEL_CALLS_PER_DECISION,
  EMPTY_MODEL_SERVICE,
} from "./model-service";

/**
 * The agent side of the model boundary — the model-shaped twin of
 * `tool-service.test.ts`. Budget enforcement, cross-decision isolation, and
 * the same `#private` port-privacy guarantee the tool service earned after a
 * real hole was found in Stage 36.
 */

const REQUEST = {
  messages: [{ role: "user" as const, content: "hi" }],
  responseSchema: { type: "object" },
};

function invoker(): ModelInvoker & { readonly seen: ModelInvocationRequest[] } {
  const seen: ModelInvocationRequest[] = [];

  return {
    seen,
    installedProfileIds: () => ["design-engineer-default"],
    generate: (request) => {
      seen.push(request);
      return Promise.resolve({
        type: "success",
        requestId: request.requestId,
        providerId: "openrouter",
        model: "openai/gpt-4o-mini",
        output: {},
        durationMs: 1,
      });
    },
  };
}

function service(
  overrides: Partial<{ maxCalls: number; onStart: unknown; onCall: unknown }> = {},
  boundInvoker: ModelInvoker = invoker(),
): AgentScopedModelService {
  return new AgentScopedModelService({
    invoker: boundInvoker,
    profileId: "design-engineer-default",
    maxCalls: overrides.maxCalls ?? DEFAULT_MAX_MODEL_CALLS_PER_DECISION,
    agentId: "test-agent",
    workerId: "test-worker",
    ...(overrides.onStart !== undefined
      ? { onStart: overrides.onStart as (info: { requestId: string; profileId: string }) => void }
      : {}),
    ...(overrides.onCall !== undefined
      ? { onCall: overrides.onCall as (result: ModelResult) => void }
      : {}),
  });
}

// ── A successful call ────────────────────────────────────────────

describe("a call within budget", () => {
  test("reaches the invoker bound to the agent's own profile", async () => {
    const spy = invoker();
    const result = await service({}, spy).generate(REQUEST);

    expect(result.type).toBe("success");
    expect(spy.seen[0]?.profileId).toBe("design-engineer-default");
    expect(spy.seen[0]?.agentId).toBe("test-agent");
    expect(spy.seen[0]?.workerId).toBe("test-worker");
  });

  test("mints a fresh requestId per call, unseen by the agent beforehand", async () => {
    const spy = invoker();
    const svc = service({}, spy);

    await svc.generate(REQUEST);
    await svc.generate(REQUEST);

    expect(spy.seen[0]?.requestId).not.toBe(spy.seen[1]?.requestId);
    expect(spy.seen[0]?.requestId.length).toBeGreaterThan(0);
  });

  test("fires onStart before the call and onCall after", async () => {
    const events: string[] = [];

    const svc = service({
      onStart: () => events.push("start"),
      onCall: () => events.push("call"),
    });

    await svc.generate(REQUEST);

    expect(events).toEqual(["start", "call"]);
  });
});

// ── 17. Budget, enforced outside the agent ──────────────────────

describe("the model-call budget", () => {
  test("allows exactly the budget, refuses the next", async () => {
    const svc = service({ maxCalls: 3 });

    for (let index = 0; index < 3; index++) {
      expect((await svc.generate(REQUEST)).type).toBe("success");
    }

    const fourth = await svc.generate(REQUEST);
    expect(fourth.type).toBe("failure");
    if (fourth.type === "failure") {
      expect(fourth.code).toBe("ERR_AGENT_MODEL_BUDGET_EXCEEDED");
    }
  });

  test("calls beyond the budget never reach the invoker", async () => {
    const spy = invoker();
    const svc = service({ maxCalls: 2 }, spy);

    for (let index = 0; index < 10; index++) await svc.generate(REQUEST);

    expect(spy.seen).toHaveLength(2);
  });

  test("concurrent calls cannot race past the budget", async () => {
    const spy = invoker();
    const svc = service({ maxCalls: 3 }, spy);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => svc.generate(REQUEST)),
    );

    expect(results.filter((r) => r.type === "success")).toHaveLength(3);
    expect(spy.seen).toHaveLength(3);
  });

  test("a fresh service gets a fresh budget", async () => {
    const spy = invoker();

    const first = service({ maxCalls: 1 }, spy);
    await first.generate(REQUEST);
    await first.generate(REQUEST);

    const second = service({ maxCalls: 1 }, spy);
    const result = await second.generate(REQUEST);

    expect(result.type).toBe("success");
    expect(spy.seen).toHaveLength(2);
  });

  test("callCount reflects attempts, including refused ones", async () => {
    const svc = service({ maxCalls: 1 });

    await svc.generate(REQUEST);
    await svc.generate(REQUEST);

    expect(svc.callCount).toBe(2);
  });
});

// ── Port privacy ─────────────────────────────────────────────────

describe("what an agent can reach through the port", () => {
  test("only generate is visible — no reflection reaches the invoker", () => {
    const svc = service();

    expect(Object.keys(svc)).toEqual(["generate"]);
    expect(Object.getOwnPropertyNames(svc)).toEqual(["generate"]);
    expect(JSON.stringify(svc)).toBe("{}");
  });

  test("the instance is frozen, so generate cannot be replaced", () => {
    const svc = service();

    expect(() => {
      (svc as { generate: unknown }).generate = () => Promise.resolve({});
    }).toThrow();
  });

  test("no property on the prototype chain names the invoker", () => {
    const svc = service();
    const proto = Object.getPrototypeOf(svc) as object;

    for (const forbidden of ["invoker", "registry", "runtime"]) {
      expect(Object.getOwnPropertyNames(proto)).not.toContain(forbidden);
    }
  });
});

// ── EMPTY_MODEL_SERVICE ──────────────────────────────────────────

describe("EMPTY_MODEL_SERVICE", () => {
  test("every call fails with a stable, non-crashing code", async () => {
    const result = await EMPTY_MODEL_SERVICE.generate(REQUEST);

    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.code).toBe("ERR_MODEL_PROFILE_NOT_FOUND");
    }
  });

  test("is frozen and exposes only generate", () => {
    expect(Object.keys(EMPTY_MODEL_SERVICE)).toEqual(["generate"]);
    expect(Object.isFrozen(EMPTY_MODEL_SERVICE)).toBe(true);
  });
});
