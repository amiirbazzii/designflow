// apps/designflow-cli/src/commands/run.ts
import { heading } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext, ResolvedWorker } from "../services/cli-runner";
import type { WorkerInputField } from "@designflow/sdk";
import { clarify, finishSession, watchProgress } from "./session-flow";

/**
 * `designflow run <worker>` — hire a worker and see the job through.
 *
 * The name resolves through the worker catalogue, the *decision* about what to
 * do comes from an Agent Session, and the run itself goes through
 * `WorkflowRunner`. Everything shown — the checklist, the approval reason, the
 * counts, the narration — comes from the product layer, so the command counts
 * nothing and cannot disagree with the engine.
 *
 * This file does not know whether a worker delegated to an agent, and does not
 * choose a workflow: it asks the session what should happen and renders the
 * answer. Three outcomes are possible — run, ask, refuse — with no fallback of
 * its own, because a fallback would be this command quietly deciding after the
 * layer that decides declined to.
 *
 * `request_clarification` used to end the process here. Stage 39 gave it
 * somewhere to go instead: while the person is still at the terminal, this
 * loops — ask, answer, resume — bounded by the session's own externally
 * enforced turn limit. Stepping away (or running out of scripted answers, in
 * a test) leaves the session waiting rather than losing it; `designflow answer
 * <session-id>` picks the same conversation back up later.
 *
 * Input fields come from the worker's own manifest rather than a table in this
 * file, so adding a worker adds no code here.
 */

export async function runCommand(
  context: CliContext,
  terminal: Terminal,
  name: string,
): Promise<number> {
  const resolved = context.resolve(name);

  if (resolved === null) {
    terminal.print(`No such worker: ${name}`);
    terminal.print();
    terminal.print("Run  designflow list  to see who is available.");
    return 1;
  }

  const { worker, workflowId } = resolved;

  if (!resolved.workflowInstalled) {
    terminal.print(
      `${worker.name} needs the "${workflowId}" workflow, which is not installed.`,
    );
    terminal.print();
    terminal.print("Install it, or run  designflow list  to see who is ready.");
    return 1;
  }

  terminal.print(heading(worker.name));
  terminal.print(worker.description);

  // Teach the worker's name when someone reaches for the workflow id.
  if (name !== worker.id) {
    terminal.print();
    terminal.print(`(${name} is a workflow — its worker is ${worker.id})`);
  }

  terminal.print();

  const input = await collectInput(terminal, resolved);

  // Attached before the session starts, and left attached through the whole
  // clarification loop: a workflow might start on the very first decision, or
  // only after several resumed ones, and either way `runner.start` runs and
  // settles inside whichever `sessions` call gets there — there is no later
  // point at which attaching this would still see every step land.
  watchProgress(context, terminal);

  // The collected answers are the request. What to do with them is not this
  // command's call — a session starts, and the session decides.
  const started = await context.sessions.startSessionForWorker(resolved.worker, {
    workerId: resolved.worker.id,
    request: describeRequest(input),
    input,
  });

  const result = await clarify(context, terminal, worker.name, started);
  if (result === null) return 1;

  return finishSession(context, terminal, result);
}

// ── Input ────────────────────────────────────────────────────────

async function collectInput(
  terminal: Terminal,
  resolved: ResolvedWorker,
): Promise<Record<string, unknown>> {
  const fields: readonly WorkerInputField[] = resolved.worker.inputs;
  const input: Record<string, unknown> = {};

  for (const field of fields) {
    const answer = await terminal.ask(
      `${field.label} (${field.placeholder})`,
      field.choices,
    );

    // An empty answer takes the placeholder, so pressing through the form
    // still produces a working run.
    const value = answer.trim().length > 0 ? answer.trim() : field.placeholder;

    input[field.key] =
      field.list === true
        ? value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        : value;
  }

  return input;
}

/**
 * The collected form as a sentence.
 *
 * `run <worker>` has no free-text prompt — the answers *are* the request — so
 * this is what a decision-maker gets to read. Empty in, empty out: a form
 * nobody filled in describes no work, and saying so honestly is what lets an
 * agent ask for detail rather than be handed "{}" and guess.
 */
function describeRequest(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value] as const)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("; ");
}
