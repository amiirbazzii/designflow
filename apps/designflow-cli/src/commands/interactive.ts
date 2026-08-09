// apps/designflow-cli/src/commands/interactive.ts
import {
  banner,
  menu,
  shellHelp,
  type Terminal,
} from "../ui/terminal";

import {
  EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID,
  type CliContext,
} from "../services/cli-runner";
import { runCommand } from "./run";

/**
 * `designflow` with no arguments — the application shell.
 *
 * The default entry point, and the one a first-time reader sees. It loops so
 * the session is a place to work rather than a single command.
 *
 * Starting the flow deliberately resolves the installed worker from the
 * registry and then calls the same run command used by an explicit invocation.
 * The shell owns presentation only; it does not duplicate workflow behavior.
 */
export async function interactiveCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  terminal.print(banner());

  for (;;) {
    terminal.print(menu());

    const choice = (await terminal.ask("Command", ["Enter", "q", "?"]))
      .trim()
      .toLowerCase();

    if (choice === "q" || choice === "quit" || choice === "exit") {
      terminal.print();
      terminal.print("Goodbye.");
      return 0;
    }

    if (choice === "?") {
      terminal.print(shellHelp());
      continue;
    }

    if (
      choice.length === 0 ||
      choice === "start" ||
      choice === "design" ||
      choice === "run"
    ) {
      const worker = context.workers
        .listWorkers()
        .find((candidate) =>
          candidate.workflows.includes(EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID),
        );

      if (worker === undefined) {
        terminal.print();
        terminal.print("The design worker is not installed.");
        terminal.print("Run  designflow list  to see the available workers.");
        continue;
      }

      terminal.print();
      terminal.print("Starting Design Engineer...");
      await runCommand(context, terminal, worker.id, {
        interactive: true,
        offerArtifactView: true,
        productExperience: true,
      });
      continue;
    }

    terminal.print();
    terminal.print(`Not a shell command: ${choice}`);
  }
}
