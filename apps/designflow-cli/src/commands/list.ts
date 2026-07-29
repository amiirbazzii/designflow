// apps/designflow-cli/src/commands/list.ts
import { heading } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";

/**
 * `designflow list` — the workers this installation offers.
 *
 * Workers, not workflows. A person hires a Design Engineer; the fact that it
 * runs a `design-to-code` pipeline is an implementation detail they should
 * never need to learn. Workflow ids are still accepted by `run`, but they are
 * no longer shown.
 */
export async function listCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  const grouped = context.workers.listByCategory();

  terminal.print(heading("Available AI Workers"));

  if (grouped.size === 0) {
    terminal.print("No workers are installed.");
    return 0;
  }

  for (const [category, workers] of grouped) {
    terminal.print();
    terminal.print(`  ${category}`);

    for (const worker of workers) {
      terminal.print();
      terminal.print(`    ${worker.name}`);
      terminal.print(`      ${worker.description}`);
      terminal.print(`      designflow run ${worker.id}`);
    }
  }

  terminal.print();
  return 0;
}
