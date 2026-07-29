// apps/designflow-cli/src/commands/interactive.ts
import { banner, menu, workerMenu } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";
import { historyCommand } from "./history";
import { runCommand } from "./run";
import { settingsCommand } from "./settings";

/**
 * `designflow` with no arguments — the application shell.
 *
 * The default entry point, and the one a first-time reader sees. It loops so the
 * session is a place to work rather than a single command: pick an action, do
 * it, come back to the menu.
 *
 * Every option maps to the same command a flag would reach, so there is one
 * implementation of each behaviour and the two surfaces cannot drift.
 */
export async function interactiveCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  terminal.print(banner());

  for (;;) {
    terminal.print(menu());

    const choice = (
      await terminal.ask("Choose an option", ["1", "2", "3", "4"])
    )
      .trim()
      .toLowerCase();

    if (choice === "4" || choice === "exit" || choice === "quit" || choice === "q") {
      terminal.print();
      terminal.print("Goodbye.");
      return 0;
    }

    if (choice === "1" || choice === "use" || choice === "run") {
      const workerId = await chooseWorker(context, terminal);
      if (workerId !== null) {
        await runCommand(context, terminal, workerId);
      }
      continue;
    }

    if (choice === "2" || choice === "history") {
      await historyCommand(context, terminal);
      continue;
    }

    if (choice === "3" || choice === "settings") {
      await settingsCommand(context, terminal);
      continue;
    }

    terminal.print();
    terminal.print(`Not an option: ${choice}`);
  }
}

/**
 * The worker picker.
 *
 * Reads the registry every time rather than closing over a list, so a worker
 * registered by a host — or a worker package added later — appears with no
 * change here. Nothing in this file names a worker.
 *
 * The catalogue is always shown, even when it holds one entry. Auto-selecting
 * the only worker saves a keystroke and hides the thing the menu exists to
 * show; pressing return picks it instead.
 *
 * Returns null when there is nothing to run, or when the answer matched nothing.
 */
async function chooseWorker(
  context: CliContext,
  terminal: Terminal,
): Promise<string | null> {
  const workers = context.workers.listWorkers();

  if (workers.length === 0) {
    terminal.print();
    terminal.print("No AI Workers are installed.");
    terminal.print();
    terminal.print("Install a worker package, then run  designflow list.");
    return null;
  }

  terminal.print(workerMenu(workers));

  const answer = (await terminal.ask("Which worker?")).trim();

  // Blank means "the first one", which is the whole catalogue when there is
  // only one worker.
  if (answer.length === 0) return workers[0]?.id ?? null;

  const byIndex = workers[Number(answer) - 1];
  const chosen = byIndex ?? workers.find((worker) => worker.id === answer);

  if (chosen === undefined) {
    terminal.print();
    terminal.print(`Not a worker: ${answer}`);
    return null;
  }

  return chosen.id;
}
