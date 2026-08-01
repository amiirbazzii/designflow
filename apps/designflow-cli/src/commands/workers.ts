// apps/designflow-cli/src/commands/workers.ts
import {
  displayProviderName,
  heading,
  type Terminal,
} from "../ui/terminal";

import type { CliContext } from "../services/cli-runner";

/**
 * `designflow workers` — the workers this installation offers. `designflow
 * list` is the same command under its original name, kept as an alias.
 *
 * Workers, not workflows. A person hires a Design Engineer; the fact that it
 * runs a `design-to-code` pipeline is an implementation detail they should
 * never need to learn. Workflow ids are still accepted by `run`, but they are
 * no longer shown.
 */
export async function workersCommand(
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
  terminal.print("Run  designflow workers <worker-id>  to see one worker's detail.");
  terminal.print();
  return 0;
}

/**
 * `designflow workers <worker-id>` — one worker's detail.
 *
 * Every field here comes from the worker's own manifest or from the same
 * `modelAssignments` list `designflow settings` reads — never a second,
 * hand-maintained description. Adding a worker adds no code to this file.
 */
export async function workerDetailCommand(
  context: CliContext,
  terminal: Terminal,
  workerId: string,
): Promise<number> {
  const worker = context.workers.getWorker(workerId);

  if (worker === undefined) {
    terminal.print(`No such worker: ${workerId}`);
    terminal.print();
    terminal.print("Run  designflow workers  to see who is available.");
    return 1;
  }

  terminal.print(heading(worker.name));
  terminal.print(worker.description);
  terminal.print();
  terminal.print(`  Category   ${worker.category}`);

  if (worker.projectContext !== undefined) {
    const { relevantFacts, relevantMemory } = worker.projectContext;
    if (relevantFacts.length > 0 || relevantMemory.length > 0) {
      terminal.print(`  Project    ${[...relevantFacts, ...relevantMemory].join(", ")}`);
    }
  }

  const assignment = context.modelAssignments.find((entry) => entry.workerName === worker.name);
  if (assignment !== undefined) {
    terminal.print(`  Provider   ${displayProviderName(assignment.providerId)}`);
    terminal.print(`  Model      ${assignment.model}`);
  }

  if (worker.inputs.length > 0) {
    terminal.print();
    terminal.print("  Asks for:");
    for (const field of worker.inputs) {
      terminal.print(`    ${field.label} (${field.placeholder})`);
    }
  }

  terminal.print();
  terminal.print(`  designflow run ${worker.id}`);
  terminal.print();
  return 0;
}
