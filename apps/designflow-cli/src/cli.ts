// apps/designflow-cli/src/cli.ts
import { usage } from "./ui/terminal";
import type { Terminal } from "./ui/terminal";
import type { CliContext } from "./services/cli-runner";
import { listCommand } from "./commands/list";
import { runCommand } from "./commands/run";
import { historyCommand } from "./commands/history";
import { interactiveCommand } from "./commands/interactive";

export const CLI_VERSION = "0.1.0";

/**
 * Argument parsing and dispatch.
 *
 * Hand-rolled rather than delegated to an argument library: there are four
 * commands, and a global `npm install -g designflow` is nicer for having one
 * fewer dependency to audit.
 *
 * Separated from `main.ts` so the whole surface is testable by calling
 * `dispatch(argv, context, terminal)` with no process involved.
 */
export async function dispatch(
  argv: readonly string[],
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  const [command, ...rest] = argv;

  if (command === "--help" || command === "-h" || command === "help") {
    terminal.print(usage());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    terminal.print(CLI_VERSION);
    return 0;
  }

  if (command === undefined) {
    return interactiveCommand(context, terminal);
  }

  switch (command) {
    case "list":
      return listCommand(context, terminal);

    case "history": {
      const workflowId = rest[0];
      return historyCommand(
        context,
        terminal,
        workflowId !== undefined ? { workflowId } : undefined,
      );
    }

    case "run": {
      const name = rest[0];

      if (name === undefined) {
        terminal.print("Which worker? For example:");
        terminal.print();
        terminal.print("  designflow run design-engineer");
        terminal.print();
        terminal.print("Run  designflow list  to see who is available.");
        return 1;
      }

      return runCommand(context, terminal, name);
    }

    default:
      terminal.print(`Unknown command: ${command}`);
      terminal.print();
      terminal.print(usage());
      return 1;
  }
}
