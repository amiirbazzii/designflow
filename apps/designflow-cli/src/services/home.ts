// apps/designflow-cli/src/services/home.ts
import { mkdirSync } from "node:fs";
import {
  cacheDir,
  configExists,
  configHome,
  configPath,
  historyDir,
  loadConfig,
  saveConfig,
  authDir,
  authSessionPath,
  type Config,
} from "./config";

/**
 * The local application directory, and the first run that creates it.
 *
 * `npm install -g designflow` puts a binary on the path and nothing else. The
 * first invocation is where the CLI becomes an installed application: it lays
 * out `~/.designflow`, writes a config someone can discover and edit, and says
 * hello once.
 *
 *   ~/.designflow/
 *     config.json     settings, written with defaults on first run
 *     history/        run records and their events
 *     cache/          reserved
 *
 * This module does filesystem work and returns facts. It prints nothing — the
 * onboarding text lives in `ui/terminal.ts` and is rendered by `dispatch`,
 * which keeps every byte of output in one layer and makes the first-run path
 * testable without a terminal.
 */

export interface HomeLayout {
  readonly home: string;
  readonly configFile: string;
  readonly history: string;
  readonly cache: string;
  readonly auth: string;
  readonly authSessionFile: string;
}

export interface HomeState {
  /**
   * True when this invocation had setup work to do.
   *
   * Keyed off `firstRunCompleted` in the config rather than off the directory
   * existing, so a directory left half-created by an interrupted first run
   * finishes its setup on the next launch instead of silently skipping it.
   */
  readonly firstRun: boolean;
  /**
   * True only for an installation that had no config at all — someone genuinely
   * new, for whom onboarding is accurate.
   *
   * Distinct from `firstRun` because of the upgrade case. A user coming from a
   * CLI that predates `firstRunCompleted` has a config without that key, so
   * setup still has a flag to write — but telling them DesignFlow "set up
   * ~/.designflow" would describe work it did not do, about a directory they
   * have been using for weeks.
   *
   * The cost is that an interrupted *first* run leaves a config behind and so
   * loses its welcome. That is a rare crash trading against a wrong greeting
   * shown to every upgrading user, which is the better way round.
   */
  readonly newInstall: boolean;
  readonly layout: HomeLayout;
  readonly config: Config;
}

export function homeLayout(): HomeLayout {
  return {
    home: configHome(),
    configFile: configPath(),
    history: historyDir(),
    cache: cacheDir(),
    auth: authDir(),
    authSessionFile: authSessionPath(),
  };
}

/**
 * Prepares `~/.designflow`, creating whatever is missing.
 *
 * Idempotent: every directory is created with `recursive: true`, and the config
 * is written only when it is absent or still marks the first run incomplete. A
 * second invocation touches nothing and reports `firstRun: false`.
 */
export function initializeHome(): HomeState {
  const layout = homeLayout();

  // Read before anything is created: once the directories exist, there is no
  // way left to tell a new installation from an upgraded one.
  const newInstall = !configExists();
  const loaded = loadConfig();

  // A config that exists and says setup finished means there is nothing to do.
  const firstRun = newInstall || !loaded.firstRunCompleted;

  for (const dir of [layout.home, layout.history, layout.cache, layout.auth]) {
    mkdirSync(dir, { recursive: true });
  }

  if (!firstRun) {
    return { firstRun: false, newInstall: false, layout, config: loaded };
  }

  // Preserves every other setting, so an upgraded config keeps the database
  // path it was already using rather than silently pointing somewhere new.
  const config: Config = { ...loaded, firstRunCompleted: true };
  saveConfig(config);

  return { firstRun: true, newInstall, layout, config };
}
