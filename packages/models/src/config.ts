// packages/models/src/config.ts
import { modelProfileSchema, type ModelProfile } from "@designflow/sdk";
import { ModelConfigurationInvalidError } from "./errors";

/**
 * The configuration precedence for a model profile.
 *
 * Four sources, checked in order, and the order is the whole point:
 *
 *   1. test-only explicit dependency injection — a test constructs a
 *      `ModelProfile` by hand and hands it straight to a registry, never
 *      touching this function at all. Nothing here can override that,
 *      because nothing here runs.
 *
 *   2. a local config override for a specific profile id — what a person
 *      testing a different model edits in `config.json`, without touching
 *      source code or any other agent's profile.
 *
 *   3. the registered profile's own defaults — what an agent package shipped
 *      with, before any local override is considered.
 *
 *   4. no implicit fallback. A profile id with neither a default nor an
 *      override does not resolve to *some* model chosen for it; it does not
 *      resolve at all.
 *
 * This function *is* steps 2 and 3: it takes the built-in defaults and a
 * local override bag, and returns what a `ModelProfileRegistry` should
 * actually be constructed with. Step 1 happens by a test simply not calling
 * this. Step 4 is what happens if a caller looks up an id this returns
 * nothing for — `ERR_MODEL_PROFILE_NOT_FOUND`, never a guess.
 */
export interface ModelProfileOverride {
  readonly providerId?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  /**
   * Gateway routing preference (e.g. OpenRouter upstream order). Already part
   * of `modelProfileSchema`; exposed here so a local config can pin a model
   * to an upstream that supports DesignFlow's strict structured outputs.
   */
  readonly providerRouting?: {
    readonly order?: readonly string[];
    readonly allowFallbacks?: boolean;
    readonly dataCollection?: "allow" | "deny";
  };
}

/**
 * Merges local overrides onto built-in profile defaults.
 *
 * Field-wise, not whole-object: a local config that only names a different
 * `model` slug does not have to repeat `providerId`, `temperature` and every
 * other field to avoid losing them — the override is a patch, not a
 * replacement. A profile with no override at all passes through unchanged,
 * which is what lets one agent's model be tested without touching another's.
 *
 * Refuses rather than silently ignores an override that produces an invalid
 * profile — a local config asking for something `modelProfileSchema` would
 * reject (an empty model slug, an out-of-range temperature) fails loudly at
 * the point it was read, not quietly on the first run that needed it.
 */
export function mergeModelProfileOverrides(
  defaults: readonly ModelProfile[],
  overrides: Readonly<Record<string, ModelProfileOverride>>,
): readonly ModelProfile[] {
  return defaults.map((profile) => {
    const override = overrides[profile.id];
    if (override === undefined) return profile;

    const merged = modelProfileSchema.safeParse({ ...profile, ...override });

    if (!merged.success) {
      throw new ModelConfigurationInvalidError(
        profile.id,
        merged.error.issues.map((issue) => {
          const path = issue.path.join(".");
          return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        }),
      );
    }

    return merged.data;
  });
}
