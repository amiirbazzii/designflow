// packages/agents/src/flagship-model-routing.test.ts
import { describe, expect, test } from "bun:test";
import { designInterpreterDefaultModelProfile } from "./design-interpreter";
import { projectMapperDefaultModelProfile } from "./project-mapper";
import { uiBuilderDefaultModelProfile } from "./ui-builder";
import { visualCriticDefaultModelProfile } from "./visual-validation";

/**
 * A guard against the V2-10 field defect (executionId
 * 0506a14f-a052-4ff7-a0ce-95ad40126677): both `design-interpreter-agent` and
 * `project-mapper-agent` exhausted every candidate on the real managed
 * gateway with `ERR_MODEL_ROUTE_NOT_FOUND` for `openai/gpt-5.6-luna` and
 * `deepseek/deepseek-v4-pro` — the exact two candidates
 * `figma-specification-default`'s own comment already documented as
 * field-proven dead (run d840ab80, `ERR_MODEL_UNAVAILABLE`).
 *
 * This cannot verify the gateway actually has a route for the surviving
 * primary candidate — that is a deployed-configuration fact this repository
 * does not own, and no test here may claim it without a live call (see
 * `packages/agents/README` / the V2-10 corrective task). What it CAN check,
 * deterministically and without any network access, is that nobody
 * reintroduces a candidate this codebase already has field evidence is dead,
 * and that the four current flagship profile ids stay exactly what the
 * managed gateway is expected to recognize.
 */

const KNOWN_DEAD_CANDIDATES = ["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro"];

const FLAGSHIP_PROFILES = [
  { role: "Design Interpreter", profile: designInterpreterDefaultModelProfile, expectedId: "design-interpreter-default" },
  { role: "Project Mapper", profile: projectMapperDefaultModelProfile, expectedId: "project-mapper-default" },
  { role: "UI Builder", profile: uiBuilderDefaultModelProfile, expectedId: "ui-builder-default" },
  { role: "Visual Critic", profile: visualCriticDefaultModelProfile, expectedId: "visual-critic-default" },
] as const;

describe("flagship (V2) model profile routing", () => {
  for (const { role, profile, expectedId } of FLAGSHIP_PROFILES) {
    test(`${role} keeps its exact canonical profile id`, () => {
      // Regression for section 26 of the V2-10 corrective task: normalization
      // must never silently remap a V2 profile id onto a legacy one.
      expect(profile.id).toBe(expectedId);
    });

    test(`${role} lists no candidate already proven dead on the managed gateway`, () => {
      const candidates = [profile.model, ...(profile.fallbackModels ?? [])];
      for (const dead of KNOWN_DEAD_CANDIDATES) {
        expect(candidates).not.toContain(dead);
      }
    });

    test(`${role} declares at least one model candidate`, () => {
      expect(profile.model.length).toBeGreaterThan(0);
    });
  }

  test("all four flagship profile ids are distinct", () => {
    const ids = FLAGSHIP_PROFILES.map((entry) => entry.profile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
