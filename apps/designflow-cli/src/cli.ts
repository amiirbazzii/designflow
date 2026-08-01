// apps/designflow-cli/src/cli.ts
import { onboarding, runExample, usage, version } from "./ui/terminal";
import type { Terminal } from "./ui/terminal";
import type { CliContext } from "./services/cli-runner";
import { listCommand } from "./commands/list";
import { runCommand } from "./commands/run";
import { historyCommand } from "./commands/history";
import { tracesCommand } from "./commands/traces";
import { interactiveCommand } from "./commands/interactive";
import { settingsCommand } from "./commands/settings";
import { answerCommand, cancelCommand, sessionsCommand } from "./commands/sessions";
import { sessionStatusSchema } from "@designflow/sdk";
import { CLI_VERSION } from "./version";

export { CLI_VERSION };

/**
 * Argument parsing and dispatch.
 *
 * Hand-rolled rather than delegated to an argument library: there are five
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

  // Onboarding comes before any command: a fresh install should introduce
  // itself whether the first thing typed is `designflow` or `designflow list`.
  // Shown once — the config records that setup happened.
  //
  // `newInstall`, not `firstRun`: an upgrade from a CLI predating
  // `firstRunCompleted` still has setup work to do, but telling someone it
  // "set up ~/.designflow" would describe work it did not do to a directory
  // they already had.
  if (context.home.newInstall) {
    terminal.print(onboarding(context.home.layout));
  }

  if (command === "--help" || command === "-h" || command === "help") {
    terminal.print(usage());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    terminal.print(version(CLI_VERSION));
    return 0;
  }

  if (command === undefined) {
    return interactiveCommand(context, terminal);
  }

  switch (command) {
    case "list":
      return listCommand(context, terminal);

    case "settings":
      return settingsCommand(context, terminal);

    case "history": {
      const workflowId = rest[0];
      return historyCommand(
        context,
        terminal,
        workflowId !== undefined ? { workflowId } : undefined,
      );
    }

    case "traces": {
      const traceId = rest[0];
      return tracesCommand(
        context,
        terminal,
        traceId !== undefined ? { traceId } : undefined,
      );
    }

    case "sessions": {
      const first = rest[0];

      if (first === "--status") {
        const parsed = sessionStatusSchema.safeParse(rest[1]);

        if (!parsed.success) {
          terminal.print(`Unknown status: ${rest[1] ?? ""}`);
          return 1;
        }

        return sessionsCommand(context, terminal, { status: parsed.data });
      }

      return sessionsCommand(context, terminal, first !== undefined ? { sessionId: first } : undefined);
    }

    case "answer": {
      const sessionId = rest[0];

      if (sessionId === undefined) {
        terminal.print("Which session? For example:");
        terminal.print();
        terminal.print("  designflow answer <session-id>");
        terminal.print();
        terminal.print("Run  designflow sessions  to see who is waiting on you.");
        return 1;
      }

      return answerCommand(context, terminal, sessionId);
    }

    case "cancel": {
      const sessionId = rest[0];

      if (sessionId === undefined) {
        terminal.print("Which session? For example:");
        terminal.print();
        terminal.print("  designflow cancel <session-id>");
        return 1;
      }

      return cancelCommand(context, terminal, sessionId);
    }

    case "run": {
      const name = rest[0];

      if (name === undefined) {
        terminal.print("Which worker? For example:");
        terminal.print();
        terminal.print(
          `  ${runExample(context.workers.listWorkers()[0]?.id)}`,
        );
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
