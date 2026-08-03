// apps/designflow-cli/src/services/figma-mcp-config.ts
import type { Config } from "./config";

/**
 * Reads Stage 3's experimental Figma MCP configuration out of the same open
 * `settings` bag `model-config.ts` already reads model-profile overrides
 * from — additive, no schema change needed to arrive.
 *
 * ```json
 * {
 *   "settings": {
 *     "experimental": { "designEngineerFigmaMcp": true },
 *     "figmaMcp": {
 *       "command": "npx",
 *       "args": ["-y", "some-figma-mcp-server"],
 *       "envPassthrough": ["FIGMA_ACCESS_TOKEN"],
 *       "connectTimeoutMs": 10000,
 *       "requestTimeoutMs": 30000,
 *       "maxResponseBytes": 5000000,
 *       "captureScreenshots": true
 *     }
 *   }
 * }
 * ```
 *
 * `envPassthrough` names environment variables to forward into the spawned
 * server's process — it never carries a credential's *value*. The
 * credential itself is read once, here, straight from `process.env`, at the
 * moment the server is spawned, and is never written to `config.json`,
 * never logged, and never placed on anything this module returns except
 * inside the one `env` map handed directly to `child_process.spawn`.
 */

export interface FigmaMcpConfig {
  readonly command: string;
  readonly args: readonly string[];
  /** Resolved from `process.env` at read time — never a literal from config.json. */
  readonly env: Readonly<Record<string, string>>;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly captureScreenshots: boolean;
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

function readStringArray(source: Record<string, unknown>, key: string): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Whether the Stage 3 experimental Figma MCP path is enabled at all — off unless explicitly set. */
export function readExperimentalFigmaMcpEnabled(config: Config): boolean {
  const experimental = config.settings["experimental"];
  if (!isRecord(experimental)) return false;
  return experimental["designEngineerFigmaMcp"] === true;
}

/**
 * The configured Figma MCP server, or `undefined` when none is configured —
 * distinct from "configured but unreachable," which only surfaces once a
 * connection is actually attempted.
 */
export function readFigmaMcpConfig(config: Config): FigmaMcpConfig | undefined {
  const raw = config.settings["figmaMcp"];
  if (!isRecord(raw)) return undefined;

  const command = readString(raw, "command");
  if (command === undefined) return undefined;

  const env: Record<string, string> = {};
  for (const name of readStringArray(raw, "envPassthrough")) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }

  const connectTimeoutMs = readNumber(raw, "connectTimeoutMs");
  const requestTimeoutMs = readNumber(raw, "requestTimeoutMs");
  const maxResponseBytes = readNumber(raw, "maxResponseBytes");
  const captureScreenshots = raw["captureScreenshots"] !== false;

  return {
    command,
    args: readStringArray(raw, "args"),
    env,
    ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
    ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {}),
    ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
    captureScreenshots,
  };
}
