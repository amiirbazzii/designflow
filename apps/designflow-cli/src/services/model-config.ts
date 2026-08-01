// apps/designflow-cli/src/services/model-config.ts
import type { Config } from "./config";

/**
 * Reads model-profile overrides out of the open `settings` bag.
 *
 * `Config.settings` is deliberately a validated-but-open `Record<string,
 * unknown>` — additive settings need no schema change to arrive. Model
 * profile overrides live at `settings.models.profiles`, read defensively
 * field by field rather than trusted as a shape: this file only ever
 * extracts the five primitive fields `mergeModelProfileOverrides` knows how
 * to apply, and silently ignores anything else at this level. The overrides
 * that *do* extract still go through `modelProfileSchema` one layer up, in
 * `@designflow/models` — this is narrowing untyped JSON into a candidate
 * shape, not validation.
 *
 * The example from the stage brief:
 *
 * ```json
 * {
 *   "settings": {
 *     "models": {
 *       "profiles": {
 *         "design-engineer-default": {
 *           "providerId": "openrouter",
 *           "model": "some/model-slug"
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 */

export interface RawModelProfileOverride {
  readonly providerId?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readOverride(value: unknown): RawModelProfileOverride | undefined {
  if (!isRecord(value)) return undefined;

  const providerId = readString(value, "providerId");
  const model = readString(value, "model");
  const temperature = readNumber(value, "temperature");
  const maxOutputTokens = readNumber(value, "maxOutputTokens");
  const timeoutMs = readNumber(value, "timeoutMs");

  const override: RawModelProfileOverride = {
    ...(providerId !== undefined ? { providerId } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };

  return Object.keys(override).length > 0 ? override : undefined;
}

/**
 * Every profile override a local config names, keyed by profile id.
 *
 * Missing, malformed, or entirely absent config all answer the same way: no
 * overrides. There is no implicit fallback hiding in this function — an
 * absent override means the registered profile's own default is what
 * `mergeModelProfileOverrides` keeps, never a guess this function makes on
 * its own.
 */
export function readModelProfileOverrides(
  config: Config,
): Readonly<Record<string, RawModelProfileOverride>> {
  const models = config.settings["models"];
  if (!isRecord(models)) return {};

  const profiles = models["profiles"];
  if (!isRecord(profiles)) return {};

  const overrides: Record<string, RawModelProfileOverride> = {};

  for (const [profileId, raw] of Object.entries(profiles)) {
    const override = readOverride(raw);
    if (override !== undefined) overrides[profileId] = override;
  }

  return overrides;
}
