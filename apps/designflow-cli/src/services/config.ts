// apps/designflow-cli/src/services/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * CLI configuration, at `~/.designflow/config.json`.
 *
 * Deliberately thin. `environment` is the one setting that means something
 * today; `settings` is a validated bag so a later stage can add keys without
 * a migration. There is no authentication here and none is planned for this
 * stage.
 *
 * A malformed or unreadable file falls back to defaults rather than failing:
 * a broken config should not stop someone running a workflow, and the next
 * write repairs it.
 */

export const configSchema = z.object({
  version: z.literal(1).default(1),
  /** Which host the CLI works against. Only `local` exists today. */
  environment: z.string().min(1).default("local"),
  /** Where runs are stored. Relative paths resolve against the config home. */
  databasePath: z.string().min(1).default("designflow.json"),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export type Config = z.infer<typeof configSchema>;

export function configHome(): string {
  return process.env.DESIGNFLOW_HOME ?? join(homedir(), ".designflow");
}

export function configPath(): string {
  return join(configHome(), "config.json");
}

export function loadConfig(): Config {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), "utf8"));
    const result = configSchema.safeParse(parsed);

    return result.success ? result.data : configSchema.parse({});
  } catch {
    return configSchema.parse({});
  }
}

export function saveConfig(config: Config): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(configSchema.parse(config), null, 2)}\n`);
}

/**
 * Loads the config, writing defaults on first use.
 *
 * Without this the file never appears, so a user has nothing to discover or
 * edit — "configuration support" that only reads is not support.
 */
export function ensureConfig(): Config {
  const config = loadConfig();

  if (!existsSync(configPath())) {
    saveConfig(config);
  }

  return config;
}

/** The absolute database path implied by a config. */
export function resolveDatabasePath(config: Config): string {
  return config.databasePath.startsWith("/")
    ? config.databasePath
    : join(configHome(), config.databasePath);
}
