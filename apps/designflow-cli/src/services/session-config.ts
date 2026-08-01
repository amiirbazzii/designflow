// apps/designflow-cli/src/services/session-config.ts
import type { Config } from "./config";

/**
 * Reads session limits out of the open `settings` bag.
 *
 * The same pattern `model-config.ts` uses for model-profile overrides:
 * `Config.settings` is validated-but-open, so a new limit needs no schema
 * change to arrive, and a value that does not parse as a safe positive
 * integer is silently ignored rather than breaking the CLI's own defaults.
 *
 * ```json
 * {
 *   "settings": {
 *     "sessions": {
 *       "maxClarificationTurns": 5,
 *       "expirationDays": 7
 *     }
 *   }
 * }
 * ```
 */

export interface SessionConfig {
  readonly maxClarificationTurns: number;
  readonly expirationDays: number;
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxClarificationTurns: 5,
  expirationDays: 7,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveInt(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function readSessionConfig(config: Config): SessionConfig {
  const raw = config.settings["sessions"];
  if (!isRecord(raw)) return DEFAULT_SESSION_CONFIG;

  return {
    maxClarificationTurns:
      readPositiveInt(raw, "maxClarificationTurns") ?? DEFAULT_SESSION_CONFIG.maxClarificationTurns,
    expirationDays: readPositiveInt(raw, "expirationDays") ?? DEFAULT_SESSION_CONFIG.expirationDays,
  };
}
