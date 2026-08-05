// packages/mcp/src/child-env.ts
//
// Builds the environment an MCP stdio child process receives. The child
// gets a minimal, platform-aware process-startup baseline plus the
// variables the caller explicitly authorized (the resolved `envPassthrough`
// map) — never the whole parent environment. Anything a shell happens to
// carry (provider keys, cloud credentials, CI tokens, unrelated app
// secrets) stays out unless it was named deliberately.

/**
 * Baseline names inherited on every platform: executable discovery, temp
 * directories, and locale. Nothing here can carry a credential.
 */
export const MCP_CHILD_ENV_BASELINE_COMMON: readonly string[] = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
];

/** POSIX additions: user-directory resolution. */
export const MCP_CHILD_ENV_BASELINE_POSIX: readonly string[] = ["HOME"];

/**
 * Windows additions: process startup (`SystemRoot` is required by Node's
 * own networking stack, `COMSPEC`/`PATHEXT` by command resolution),
 * user-directory resolution, and the per-user application-data roots that
 * `npx`-launched servers need to locate npm's configuration and cache.
 */
export const MCP_CHILD_ENV_BASELINE_WINDOWS: readonly string[] = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
];

/**
 * Keys that must never become properties of the constructed object no
 * matter where a name came from — they change object semantics rather than
 * describe an environment variable.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface McpChildEnvOptions {
  /** Defaults to `process.platform`. Explicit so Windows behavior is testable anywhere. */
  readonly platform?: NodeJS.Platform;
  /** Defaults to `process.env`. Explicit so tests never depend on the runner's shell. */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
  /**
   * The explicitly authorized variables (already name-validated and
   * value-resolved upstream, e.g. via `envPassthrough`). Added after the
   * baseline, so a deliberately authorized name overrides a baseline value.
   */
  readonly authorized?: Readonly<Record<string, string>>;
}

/**
 * Returns the exact environment for `child_process.spawn`: baseline names
 * copied from the parent when present (absent names are omitted, never
 * serialized as `"undefined"`), then the authorized map on top.
 */
export function buildMcpChildEnv(options: McpChildEnvOptions = {}): Record<string, string> {
  const platform = options.platform ?? process.platform;
  const parentEnv = options.parentEnv ?? process.env;

  const baseline = [
    ...MCP_CHILD_ENV_BASELINE_COMMON,
    ...(platform === "win32" ? MCP_CHILD_ENV_BASELINE_WINDOWS : MCP_CHILD_ENV_BASELINE_POSIX),
  ];

  // A null-prototype accumulator makes special keys inert plain properties;
  // the copy at the end hands spawn an ordinary object.
  const accumulator: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const name of baseline) {
    const value = lookup(parentEnv, name, platform);
    if (value !== undefined) accumulator[name] = value;
  }

  for (const [name, value] of Object.entries(options.authorized ?? {})) {
    if (FORBIDDEN_KEYS.has(name)) continue;
    if (typeof value !== "string") continue;
    accumulator[name] = value;
  }

  return { ...accumulator };
}

/**
 * Windows environment names are case-insensitive; a parent env holding
 * `Path` must still satisfy the baseline's `PATH`. POSIX lookups stay
 * exact.
 */
function lookup(
  parentEnv: Readonly<Record<string, string | undefined>>,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  const exact = parentEnv[name];
  if (exact !== undefined || platform !== "win32") return exact;

  const lower = name.toLowerCase();
  for (const key of Object.keys(parentEnv)) {
    if (key.toLowerCase() === lower) return parentEnv[key];
  }
  return undefined;
}
