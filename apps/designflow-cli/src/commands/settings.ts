// apps/designflow-cli/src/commands/settings.ts
import {
  settings,
  type Terminal,
} from "../ui/terminal";

import { existsSync, readFileSync } from "node:fs";

import type { CliContext } from "../services/cli-runner";
import {
  describeFigmaMcp,
  describeRoleModelProfiles,
  FEATURE_TIERS,
} from "../services/readiness";
import { CLI_VERSION } from "../version";

/** Whether the file on disk still parses — the one fact `loadConfig` hides by recovering from it. */
function configReadable(path: string): boolean {
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

/**
 * `designflow settings`, and option 3 in the interactive menu.
 *
 * Answers "where does this thing keep my stuff?" — which is the only question
 * about configuration a local-only product needs to answer. It reads; it does
 * not write. Changing a setting means editing `config.json`, which is a thing
 * users already know how to do, and which cannot be corrupted by a half-answered
 * prompt.
 *
 * There is deliberately no account, no key and no endpoint to configure here —
 * and, as of the AI assignments this now shows, still no credential: whether
 * one is configured is the one fact reported, never its value.
 */
export async function settingsCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  const roles = describeRoleModelProfiles(context.roleModelProfiles);

  terminal.print(
    settings(context.home.layout, {
      version: CLI_VERSION,
      environment: context.home.config.environment,
      historyFile: context.databasePath,
      workerCount: context.workers.listWorkers().length,
      modelAssignments: context.modelAssignments,
      sessionConfig: context.sessionConfig,
      configuration: {
        exists: existsSync(context.home.layout.configFile),
        parsed: configReadable(context.home.layout.configFile),
      },
      modelMode: {
        mode: context.modelProviderConfigured ? "live" : "deterministic",
        credentialPresent: context.modelProviderConfigured,
        ...(context.roleModelProfiles[0] !== undefined
          ? { providerId: context.roleModelProfiles[0].effective.providerId }
          : {}),
      },
      roles,
      figmaMcp: describeFigmaMcp(context.home.config),
      featureTiers: FEATURE_TIERS,
    }),
  );

  return 0;
}
