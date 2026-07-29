// apps/designflow-cli/src/commands/list.ts
import { heading } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";

/**
 * `designflow list` — what this installation can do.
 *
 * Workflows are still shown by id. The worker abstraction that will replace
 * them is a later stage; naming them now would invent a vocabulary the product
 * does not yet have.
 */
export async function listCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  const workflows = context.listWorkflows();

  terminal.print(heading("Available workflows"));

  if (workflows.length === 0) {
    terminal.print("No workflows are installed.");
    return 0;
  }

  for (const workflow of workflows) {
    terminal.print();
    terminal.print(`  ${workflow.name}  (${workflow.workflowId})`);
    terminal.print(`    ${workflow.description}`);
    terminal.print(`    ${workflow.steps.length} steps`);
  }

  terminal.print();
  return 0;
}
