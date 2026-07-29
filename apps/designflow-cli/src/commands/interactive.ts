// apps/designflow-cli/src/commands/interactive.ts
import { banner, menu } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";
import { historyCommand } from "./history";
import { runCommand } from "./run";

/**
 * `designflow` with no arguments.
 *
 * The default entry point, and the one a first-time reader sees. It loops so
 * the session is a place to work rather than a single command — pick an
 * action, do it, come back to the menu.
 */
export async function interactiveCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  terminal.print(banner());

  for (;;) {
    terminal.print(menu());

    const choice = (await terminal.ask("Choose an action", ["1", "2", "3"]))
      .trim()
      .toLowerCase();

    if (choice === "3" || choice === "exit" || choice === "q") {
      terminal.print();
      terminal.print("Goodbye.");
      return 0;
    }

    if (choice === "2" || choice === "history") {
      await historyCommand(context, terminal);
      continue;
    }

    if (choice === "1" || choice === "run") {
      const workflowId = await chooseWorkflow(context, terminal);
      if (workflowId !== null) {
        await runCommand(context, terminal, workflowId);
      }
      continue;
    }

    terminal.print();
    terminal.print(`Not an option: ${choice}`);
  }
}

/** Lets the user pick by number or by id. Returns null when none is installed. */
async function chooseWorkflow(
  context: CliContext,
  terminal: Terminal,
): Promise<string | null> {
  const workflows = context.listWorkflows();

  if (workflows.length === 0) {
    terminal.print();
    terminal.print("No workflows are installed.");
    return null;
  }

  if (workflows.length === 1) {
    // Nothing to choose between; asking would be ceremony.
    return workflows[0]?.workflowId ?? null;
  }

  terminal.print();
  workflows.forEach((workflow, index) => {
    terminal.print(`  ${index + 1}. ${workflow.name}  (${workflow.workflowId})`);
  });

  const answer = (await terminal.ask("Which workflow?")).trim();
  const byIndex = workflows[Number(answer) - 1];

  return (
    byIndex?.workflowId ??
    workflows.find((workflow) => workflow.workflowId === answer)?.workflowId ??
    null
  );
}
