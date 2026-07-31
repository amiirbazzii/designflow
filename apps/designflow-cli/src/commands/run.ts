// apps/designflow-cli/src/commands/run.ts
import { heading, stepMarker } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext, ResolvedWorker } from "../services/cli-runner";
import type { WorkerInputField } from "@designflow/sdk";

/**
 * `designflow run <worker>` — hire a worker and see the job through.
 *
 * The name resolves through the worker catalogue, the *decision* about what to
 * do comes from the product boundary, and the run itself goes through
 * `WorkflowRunner`. Everything shown — the checklist, the approval reason, the
 * counts, the narration — comes from the product layer, so the command counts
 * nothing and cannot disagree with the engine.
 *
 * This file does not know whether a worker delegated to an agent, and does not
 * choose a workflow: it asks `routeTask` what should happen and renders the
 * answer. Three answers are possible and all three are handled here — run,
 * ask, refuse — with no fallback of its own, because a fallback would be this
 * command quietly deciding after the layer that decides declined to.
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

  // The collected answers are the request. What to do with them is not this
  // command's call.
  const { decision } = await context.routeTask({
    workerId: name,
    request: describeRequest(input),
    input,
  });

  if (decision.type === "request_clarification") {
    terminal.print();
    terminal.print(heading("More detail needed"));
    terminal.print(decision.question);
    terminal.print();
    terminal.print("Nothing was started. Run the worker again with an answer.");
    return 1;
  }

  if (decision.type === "decline") {
    terminal.print();
    terminal.print(heading("Not started"));
    terminal.print(decision.reason);
    terminal.print();
    return 1;
  }

  // Attach before starting: events publish while `start` is awaited, so this
  // is what makes the checklist move rather than appear all at once.
  let lastFrame = "";
  context.onProgress((progress) => {
    const frame = renderProgress(progress);
    if (frame === lastFrame) return;

    lastFrame = frame;
    terminal.print(frame);
  });

  terminal.print();
  terminal.print("Starting…");
  terminal.print();

  const execution = await context.runner.start({
    workflowId: decision.workflowId,
    input: decision.input ?? input,
  });

  const approved = await resolveApproval(context, terminal, execution.executionId);

  if (approved === false) {
    terminal.print();
    terminal.print("Stopped. Nothing was written.");
    return 1;
  }

  return report(context, terminal, execution.executionId);
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

// ── Approval ─────────────────────────────────────────────────────

/** Returns undefined when no approval was required. */
async function resolveApproval(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
): Promise<boolean | undefined> {
  const pending = await context.runner.pendingApproval(executionId);
  if (pending === null) return undefined;

  terminal.print();
  terminal.print(heading("Approval required"));
  terminal.print("DesignFlow wants permission to:");
  terminal.print();
  terminal.print("  Generate production files");
  terminal.print();
  terminal.print(`Reason: ${pending.reason}`);
  terminal.print();

  const answer = await terminal.ask("Approve?", ["approve", "reject"]);
  const approved = answer.trim().toLowerCase().startsWith("a");

  const outcome = approved
    ? await context.runner.approve(executionId, "approved from the CLI")
    : await context.runner.reject(executionId, "rejected from the CLI");

  terminal.print();
  terminal.print(outcome.message);

  return approved;
}

// ── Result ───────────────────────────────────────────────────────

async function report(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
): Promise<number> {
  const result = await context.runner.explain(executionId);
  const { overview, artifacts } = result;

  terminal.print();
  terminal.print(
    heading(overview.state === "ready" ? "Complete" : "Stopped"),
  );
  terminal.print(overview.summary);

  if (overview.durationLabel !== undefined) {
    terminal.print(`Took ${overview.durationLabel}.`);
  }

  terminal.print();
  terminal.print(`  Created  ${overview.artifacts.created}`);
  terminal.print(`  Reused   ${overview.artifacts.reused}`);

  // Each capability also registers a content-addressed payload. Those are
  // storage detail; counting them keeps the totals reconcilable with the
  // engine without filling the terminal with hashes.
  const named = artifacts.filter(
    (artifact) => artifact.name !== artifact.artifactId,
  );

  if (named.length > 0) {
    terminal.print();
    terminal.print("Artifacts");

    for (const artifact of named) {
      terminal.print(`  ${artifact.name}  (${artifact.status})`);

      if (artifact.dependencies.length > 0) {
        terminal.print(`     from ${artifact.dependencies.join(", ")}`);
      }
    }

    const blobs = artifacts.length - named.length;
    if (blobs > 0) {
      terminal.print();
      terminal.print(`  ${blobs} stored payloads not listed.`);
    }
  }

  terminal.print();
  terminal.print(`Run id: ${executionId}`);
  terminal.print();

  return overview.state === "ready" ? 0 : 1;
}

function renderProgress(progress: {
  readonly completed: number;
  readonly total: number;
  readonly steps: readonly { readonly label: string; readonly status: string }[];
}): string {
  const lines = progress.steps.map(
    (step) => `  ${stepMarker(step.status)} ${step.label}`,
  );

  lines.push("", `  ${progress.completed} of ${progress.total} steps`);

  return lines.join("\n");
}
