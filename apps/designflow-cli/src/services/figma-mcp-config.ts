// apps/designflow-cli/src/services/figma-mcp-config.ts
import type { Config } from "./config";

/** The one supported zero-config Figma Desktop MCP endpoint. */
export const STANDARD_FIGMA_DESKTOP_MCP_URL = "http://127.0.0.1:3845/mcp";

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
 *       "transport": "stdio",
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

export interface FigmaMcpStdioConfig {
  readonly transport: "stdio";
  readonly command: string;
  readonly args: readonly string[];
  /** Resolved from `process.env` at read time — never a literal from config.json. */
  readonly env: Readonly<Record<string, string>>;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly captureScreenshots: boolean;
}

export interface FigmaMcpHttpConfig {
  readonly transport: "http";
  readonly url: string;
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly captureScreenshots: boolean;
}

export type FigmaMcpConfig = FigmaMcpStdioConfig | FigmaMcpHttpConfig;

export type FigmaMcpConfigSource = "explicit" | "automatic" | "invalid" | "none";

export interface FigmaMcpConfigResolution {
  readonly config?: FigmaMcpConfig;
  readonly source: FigmaMcpConfigSource;
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

/** Stage 4 stays separately opt-in even when Stage 3 Figma MCP is enabled. */
export function readExperimentalImplementationEnabled(config: Config): boolean {
  const experimental = config.settings["experimental"];
  if (!isRecord(experimental)) return false;
  return experimental["designEngineerImplementation"] === true;
}

/**
 * The configured Figma MCP server, or `undefined` when none is configured —
 * distinct from "configured but unreachable," which only surfaces once a
 * connection is actually attempted.
 */
export function readFigmaMcpConfig(config: Config): FigmaMcpConfig | undefined {
  const raw = config.settings["figmaMcp"];
  if (!isRecord(raw)) return undefined;

  const transport = raw["transport"];
  const connectTimeoutMs = readNumber(raw, "connectTimeoutMs");
  const requestTimeoutMs = readNumber(raw, "requestTimeoutMs");
  const maxResponseBytes = readNumber(raw, "maxResponseBytes");
  const captureScreenshots = raw["captureScreenshots"] !== false;

  if (transport !== undefined && transport !== "stdio" && transport !== "http") return undefined;

  if (transport === "http") {
    const url = readString(raw, "url");
    if (url === undefined) return undefined;
    return {
      transport: "http",
      url,
      ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
      ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {}),
      ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
      captureScreenshots,
    };
  }

  const command = readString(raw, "command");
  if (command === undefined) return undefined;

  const env: Record<string, string> = {};
  for (const name of readStringArray(raw, "envPassthrough")) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }

  return {
    transport: "stdio",
    command,
    args: readStringArray(raw, "args"),
    env,
    ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
    ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {}),
    ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
    captureScreenshots,
  };
}

/**
 * Resolves the configuration used by a host invocation.
 *
 * Automatic detection is deliberately narrow: it is only allowed when the
 * caller opts into the bare interactive journey, and only when no explicit
 * `figmaMcp` setting exists. An invalid explicit block therefore remains an
 * invalid setup instead of being silently replaced with a different server.
 */
export function resolveFigmaMcpConfig(
  config: Config,
  options?: { readonly autoDetectDesktop?: boolean },
): FigmaMcpConfigResolution {
  const explicit = readFigmaMcpConfig(config);
  if (explicit !== undefined) return { config: explicit, source: "explicit" };

  const raw = config.settings["figmaMcp"];
  if (raw !== undefined) return { source: "invalid" };

  if (options?.autoDetectDesktop === true) {
    return {
      source: "automatic",
      config: {
        transport: "http",
        url: STANDARD_FIGMA_DESKTOP_MCP_URL,
        connectTimeoutMs: 1_500,
        requestTimeoutMs: 2_000,
        captureScreenshots: true,
      },
    };
  }

  return { source: "none" };
}
