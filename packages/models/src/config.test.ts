// packages/models/src/config.test.ts
import { describe, expect, test } from "bun:test";
import { DesignFlowError } from "@designflow/sdk";
import type { ModelProfile } from "@designflow/sdk";
import { mergeModelProfileOverrides } from "./config";

/**
 * The configuration precedence: registered defaults, patched field-wise by a
 * local override, with no implicit fallback for a profile id that has
 * neither.
 */

const DEFAULT: ModelProfile = {
  id: "design-engineer-default",
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
  fallbackModels: [],
};

describe("mergeModelProfileOverrides", () => {
  test("a profile with no override passes through unchanged", () => {
    const [merged] = mergeModelProfileOverrides([DEFAULT], {});
    expect(merged).toEqual(DEFAULT);
  });

  test("an override patches only the fields it names", () => {
    const [merged] = mergeModelProfileOverrides(
      [DEFAULT],
      { "design-engineer-default": { model: "openai/gpt-4o" } },
    );

    expect(merged?.model).toBe("openai/gpt-4o");
    // Everything else survived the patch.
    expect(merged?.providerId).toBe("openrouter");
    expect(merged?.id).toBe("design-engineer-default");
  });

  test("an override for one profile does not touch another", () => {
    const other: ModelProfile = { ...DEFAULT, id: "other-agent-default" };

    const [defaultProfile, otherProfile] = mergeModelProfileOverrides(
      [DEFAULT, other],
      { "design-engineer-default": { model: "openai/gpt-4o" } },
    );

    expect(defaultProfile?.model).toBe("openai/gpt-4o");
    expect(otherProfile?.model).toBe("openai/gpt-4o-mini");
  });

  test("an override naming an unknown profile id changes nothing", () => {
    // No implicit fallback: an override for a profile that was never
    // registered does not invent one.
    const [merged] = mergeModelProfileOverrides(
      [DEFAULT],
      { "nonexistent-profile": { model: "openai/gpt-4o" } },
    );

    expect(merged).toEqual(DEFAULT);
  });

  test("refuses an override that produces an invalid profile", () => {
    expect(() =>
      mergeModelProfileOverrides(
        [DEFAULT],
        { "design-engineer-default": { model: "" } },
      ),
    ).toThrow(DesignFlowError);
  });

  test("the refusal names a stable code and the offending profile", () => {
    try {
      mergeModelProfileOverrides(
        [DEFAULT],
        { "design-engineer-default": { temperature: 99 } },
      );
      throw new Error("expected the merge to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_MODEL_CONFIGURATION_INVALID");
      expect((error as DesignFlowError).metadata.profileId).toBe("design-engineer-default");
    }
  });

  test("an override can widen fields the default left unset", () => {
    const [merged] = mergeModelProfileOverrides(
      [DEFAULT],
      { "design-engineer-default": { temperature: 0.2, timeoutMs: 5_000 } },
    );

    expect(merged?.temperature).toBe(0.2);
    expect(merged?.timeoutMs).toBe(5_000);
  });
});
