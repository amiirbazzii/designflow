// apps/designflow-cli/src/services/config.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

/**
 * CLI configuration, at `~/.designflow/config.json`.
 *
 * Deliberately thin, and deliberately not a settings framework. Authentication
 * is stored separately under auth/session.json; this file only describes where
 * this installation keeps its work and whether it has been introduced yet.
 *
 * Three properties matter, and each is a decision rather than an accident:
 *
 * **Safe reading.** A malformed or unreadable file never stops a run. What can
 * be salvaged is salvaged field by field, so one bad value costs one setting
 * rather than the whole file — see `migrateConfig`.
 *
 * **Safe writing.** Written to a temporary file and renamed, so an interrupted
 * write leaves the previous config intact rather than a truncated one. The CLI
 * writes this file during startup, and a half-written config would break the
 * next launch — the worst moment to be broken.
 *
 * **Migration-friendly.** `version` is an open integer rather than a literal,
 * so a file written by a newer CLI is read rather than discarded, and its
 * version is preserved on write. Additive settings go in `settings`, which is
 * a validated bag that needs no schema change to fill.
 */

/** The shape this CLI writes. Reading accepts any positive version. */
export const CONFIG_VERSION = 1;

export const configSchema = z.object({
  /**
   * Preserved as read, not clamped to `CONFIG_VERSION` — a file from a newer
   * CLI should survive being read by this one.
   */
  version: z.number().int().positive().default(CONFIG_VERSION),
  /**
   * Set once, when the application directory is prepared. Onboarding keys off
   * this rather than off the directory existing, so a half-created directory
   * finishes its setup instead of skipping it.
   */
  firstRunCompleted: z.boolean().default(false),
  /** Which host the CLI works against. Only `local` exists today. */
  environment: z.string().min(1).default("local"),
  /** Where runs are stored. Relative paths resolve against the config home. */
  databasePath: z.string().min(1).default("history/runs.json"),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export type Config = z.infer<typeof configSchema>;

/** The default config, with nothing read from disk. */
export function defaultConfig(): Config {
  return configSchema.parse({});
}

// ── Locations ───────────────────────────────────────────────────

/**
 * The local application directory.
 *
 * `DESIGNFLOW_HOME` relocates the whole thing, which is what makes the CLI
 * testable against a temporary directory and lets one machine keep more than
 * one installation apart.
 */
export function configHome(): string {
  return process.env.DESIGNFLOW_HOME ?? join(homedir(), ".designflow");
}

export function configPath(): string {
  return join(configHome(), "config.json");
}

/** `~/.designflow/history` — run records and their events. */
export function historyDir(): string {
  return join(configHome(), "history");
}

/** `~/.designflow/cache` — reserved; nothing writes here yet. */
export function cacheDir(): string {
  return join(configHome(), "cache");
}

/** `~/.designflow/auth` — restrictive, application-managed session state. */
export function authDir(): string {
  return join(configHome(), "auth");
}

/** `~/.designflow/auth/session.json` — never included in ordinary settings. */
export function authSessionPath(): string {
  return join(authDir(), "session.json");
}

/** The absolute database path implied by a config. */
export function resolveDatabasePath(config: Config): string {
  return isAbsolute(config.databasePath)
    ? config.databasePath
    : join(configHome(), config.databasePath);
}

// ── Reading ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recovers as much of a config as parses.
 *
 * The obvious implementation — parse, and fall back to defaults on failure —
 * throws away every good setting because of one bad one. Worse, it resets
 * `firstRunCompleted`, so a single hand-edited typo would replay onboarding and
 * re-introduce the CLI to someone who has used it for weeks.
 *
 * Field-wise recovery keeps every value that validates and defaults only the
 * ones that do not.
 */
export function migrateConfig(raw: unknown): Config {
  const whole = configSchema.safeParse(raw);
  if (whole.success) return whole.data;

  const source = isRecord(raw) ? raw : {};
  const recovered: Record<string, unknown> = {};
  const shape = configSchema.shape;

  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    if (!(key in source)) continue;

    const field = shape[key].safeParse(source[key]);
    if (field.success) recovered[key] = field.data;
  }

  return configSchema.parse(recovered);
}

/** Reads the config, or returns defaults. Never throws. */
export function loadConfig(): Config {
  try {
    return migrateConfig(JSON.parse(readFileSync(configPath(), "utf8")));
  } catch {
    return defaultConfig();
  }
}

/** Whether a config file exists at all — the signal `initializeHome` reads. */
export function configExists(): boolean {
  return existsSync(configPath());
}

// ── Writing ─────────────────────────────────────────────────────

/**
 * Writes the config atomically.
 *
 * Temp file plus rename: `rename` is atomic within a filesystem, so a reader
 * sees either the old config or the new one and never a partial one.
 */
export function saveConfig(config: Config): void {
  const path = configPath();
  const validated = configSchema.parse(config);

  mkdirSync(dirname(path), { recursive: true });

  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(validated, null, 2)}\n`);
  renameSync(temp, path);
}

/** Applies a patch and persists the result. Returns what was written. */
export function updateConfig(patch: Partial<Config>): Config {
  const updated = configSchema.parse({ ...loadConfig(), ...patch });
  saveConfig(updated);
  return updated;
}
