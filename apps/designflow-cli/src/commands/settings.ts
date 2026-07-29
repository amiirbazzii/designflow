// apps/designflow-cli/src/commands/settings.ts
import { settings } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";
import { CLI_VERSION } from "../version";

/**
 * `designflow settings`, and option 3 in the interactive menu.
 *
 * Answers "where does this thing keep my stuff?" — which is the only question
 * about configuration a local-only product needs to answer. It reads; it does
 * not write. Changing a setting means editing `config.json`, which is a thing
 * users already know how to do, and which cannot be corrupted by a half-answered
 * prompt.
 *
 * There is deliberately no account, no key and no endpoint to configure here.
 */
export async function settingsCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  terminal.print(
    settings(context.home.layout, {
      version: CLI_VERSION,
      environment: context.home.config.environment,
      historyFile: context.databasePath,
      workerCount: context.workers.listWorkers().length,
    }),
  );

  return 0;
}
