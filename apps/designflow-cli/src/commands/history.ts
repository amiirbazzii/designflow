// apps/designflow-cli/src/commands/history.ts
import {
  formatWhen,
  heading,
  runExample,
  type Terminal,
} from "../ui/terminal";

import type { CliContext } from "../services/cli-runner";

/**
 * `designflow history` — previous runs.
 *
 * The reason the CLI persists anything. Each invocation is a new process, so
 * without SQLite under `~/.designflow` this command could only ever report on
 * runs from its own lifetime, which is to say none.
 */
export async function historyCommand(
  context: CliContext,
  terminal: Terminal,
  options?: { readonly workflowId?: string },
): Promise<number> {
  // `history()` with no argument spans every workflow — the product layer
  // owns that fan-out now, so the CLI no longer reaches for a repository.
  const workflowId = options?.workflowId;
  const entries =
    workflowId !== undefined
      ? await context.runner.history(workflowId)
      : await context.runner.history();

  terminal.print(heading("Previous runs"));

  if (entries.length === 0) {
    terminal.print("Nothing has run yet.");
    terminal.print();
    terminal.print(
      `Start one with:  ${runExample(context.workers.listWorkers()[0]?.id)}`,
    );
    return 0;
  }

  for (const entry of entries) {
    terminal.print();
    terminal.print(`  ${entry.workflowName}`);
    terminal.print(
      `    ${entry.status}  ·  ${formatWhen(entry.startedAt)}` +
        (entry.durationLabel !== undefined ? `  ·  ${entry.durationLabel}` : ""),
    );
    terminal.print(`    ${entry.summary}`);
    terminal.print(`    ${entry.executionId}`);
  }

  terminal.print();
  return 0;
}
