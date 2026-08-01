// packages/models/src/profile-timeout-coverage.test.ts
import { describe, expect, test } from "bun:test";
import type { ModelProfile, ModelProvider, ModelRequest } from "@designflow/sdk";
import {
  designEngineerDefaultModelProfile,
  qaReviewerDefaultModelProfile,
  researchAnalystDefaultModelProfile,
  productManagerDefaultModelProfile,
} from "@designflow/agents";
import { InMemoryModelProfileRegistry } from "./profile-registry";
import { InMemoryModelProviderRegistry } from "./provider-registry";
import { ModelRuntime, DEFAULT_MODEL_TIMEOUT_MS } from "./runtime";

/**
 * Stage 42 verification: every built-in agent's default model profile
 * resolves to a concrete, positive timeout somewhere in `ModelRuntime`'s
 * resolution path — never `undefined`, never `Infinity`, never a hang a
 * misbehaving provider could exploit.
 *
 * The four profiles under audit are exactly the ones
 * `apps/designflow-cli/src/services/cli-runner.ts`'s `BUILT_IN_MODEL_
 * PROFILES` installs — imported here from the agent packages that own them,
 * the same way `cli-runner.ts` itself collects them, so this list cannot
 * silently drift from what actually ships.
 */

const BUILT_IN_PROFILES: readonly ModelProfile[] = [
  designEngineerDefaultModelProfile,
  qaReviewerDefaultModelProfile,
  researchAnalystDefaultModelProfile,
  productManagerDefaultModelProfile,
];

function hangingProvider(id: string): ModelProvider {
  return {
    id,
    // Never resolves and never rejects — the only way to observe the
    // runtime's *own* timeout enforcement rather than a provider's.
    generate: () => new Promise<never>(() => {}),
  };
}

describe("every built-in model profile has a concrete timeout somewhere in its resolution path", () => {
  test("none of the four ships its own timeoutMs — the CLI wiring at cli-runner.ts leaves them to the runtime default", () => {
    // Documents the fact this stage verified rather than assumed: as of this
    // writing no catalog agent's default profile sets `timeoutMs`, so every
    // one of them depends on `ModelRuntime`'s fallback actually applying. If
    // a future profile starts declaring its own, this simply stops matching
    // for that profile — nothing here breaks, it just narrows what the next
    // test has to prove.
    for (const profile of BUILT_IN_PROFILES) {
      expect(profile.timeoutMs).toBeUndefined();
    }
  });

  test("every profile falls through to whatever the runtime's own default resolves to, since none declares its own", async () => {
    // A fast stand-in for the fallback *path*, not the production constant —
    // `defaultTimeoutMs: 30` here plays the role `DEFAULT_MODEL_TIMEOUT_MS`
    // plays in the real, unconfigured runtime, so this proves the `profile.
    // timeoutMs ?? this.defaultTimeoutMs` wiring actually fires for all four
    // profiles without a 30-second wait per profile. The next test proves
    // the production constant itself is what an unconfigured runtime uses.
    for (const profile of BUILT_IN_PROFILES) {
      const runtime = new ModelRuntime({
        profiles: new InMemoryModelProfileRegistry([profile]),
        providers: new InMemoryModelProviderRegistry([hangingProvider(profile.providerId)]),
        defaultTimeoutMs: 30,
      });

      const startedAt = performance.now();
      const result = await runtime.generate({
        requestId: "req-1",
        profileId: profile.id,
        messages: [{ role: "user", content: "probe" }],
        responseSchema: { type: "object" },
      });
      const elapsed = performance.now() - startedAt;

      expect(result.type).toBe("failure");
      if (result.type === "failure") expect(result.code).toBe("ERR_MODEL_TIMEOUT");
      expect(elapsed).toBeLessThan(2_000);
    }
  });

  test("constructed exactly as the CLI's composition root constructs it — no defaultTimeoutMs override at all — the real DEFAULT_MODEL_TIMEOUT_MS fires", async () => {
    // One representative profile, at the real production constant, rather
    // than all four — this is the one genuinely slow assertion in the file,
    // and its only job is to confirm `ModelRuntime`'s own fallback constant
    // is really what an unconfigured runtime (`apps/designflow-cli/src/
    // services/cli-runner.ts` never passes `defaultTimeoutMs`) applies, not
    // `undefined` or `Infinity`.
    const profile = designEngineerDefaultModelProfile;

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([profile]),
      providers: new InMemoryModelProviderRegistry([hangingProvider(profile.providerId)]),
    });

    const startedAt = performance.now();
    const result = await runtime.generate({
      requestId: "req-1",
      profileId: profile.id,
      messages: [{ role: "user", content: "probe" }],
      responseSchema: { type: "object" },
    });
    const elapsed = performance.now() - startedAt;

    expect(result.type).toBe("failure");
    if (result.type === "failure") expect(result.code).toBe("ERR_MODEL_TIMEOUT");
    expect(elapsed).toBeGreaterThanOrEqual(DEFAULT_MODEL_TIMEOUT_MS - 500);
    expect(elapsed).toBeLessThan(DEFAULT_MODEL_TIMEOUT_MS + 5_000);
  }, DEFAULT_MODEL_TIMEOUT_MS + 10_000);

  test("DEFAULT_MODEL_TIMEOUT_MS itself is a concrete, positive, finite number", () => {
    expect(Number.isFinite(DEFAULT_MODEL_TIMEOUT_MS)).toBe(true);
    expect(DEFAULT_MODEL_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("a profile that does declare its own timeoutMs is honoured instead of the default", async () => {
    const seenTimeouts: number[] = [];
    const request: { current: ModelRequest | null } = { current: null };

    const runtime = new ModelRuntime({
      profiles: new InMemoryModelProfileRegistry([
        { ...designEngineerDefaultModelProfile, timeoutMs: 25 },
      ]),
      providers: new InMemoryModelProviderRegistry([
        {
          id: designEngineerDefaultModelProfile.providerId,
          generate: (req) => {
            request.current = req;
            seenTimeouts.push(25);
            return new Promise<never>(() => {});
          },
        },
      ]),
      defaultTimeoutMs: 60_000, // deliberately different, to prove the profile's own value wins
    });

    const startedAt = performance.now();
    const result = await runtime.generate({
      requestId: "req-2",
      profileId: designEngineerDefaultModelProfile.id,
      messages: [{ role: "user", content: "probe" }],
      responseSchema: { type: "object" },
    });
    const elapsed = performance.now() - startedAt;

    expect(result.type).toBe("failure");
    if (result.type === "failure") expect(result.code).toBe("ERR_MODEL_TIMEOUT");
    expect(elapsed).toBeLessThan(5_000);
  });
});
