// apps/designflow-cli/src/commands/run.ts
import { heading, stepMarker } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext, WorkflowInfo } from "../services/cli-runner";

/**
 * `designflow run <workflow>` — start a run and see it through.
 *
 * Everything shown comes from `WorkflowRunner`: the checklist, the approval
 * reason, the counts, the narration. The command counts nothing and tracks no
 * state of its own, so it cannot report a different result than the engine
 * produced.
 */

/**
 * Input fields, per workflow.
 *
 * They live here because `WorkflowManifest` carries no field metadata yet.
 * The form is *generated* from these descriptors rather than written per
 * workflow, so a second workflow is an entry rather than a new prompt
 * sequence — but the descriptors belong on the manifest, and moving them is
 * the right next change.
 */
interface InputField {
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  readonly list?: boolean;
  readonly choices?: readonly string[];
}

const INPUT_FIELDS: Record<string, readonly InputField[]> = {
  "design-to-code": [
    { key: "designFile", label: "Design file", placeholder: "homepage.fig" },
    {
      key: "framework",
      label: "Framework",
      placeholder: "react",
      choices: ["react", "vue", "svelte"],
    },
    {
      key: "frames",
      label: "Frames (comma separated)",
      placeholder: "brand/Header, brand/Footer, layout/Dashboard",
      list: true,
    },
  ],
};

export async function runCommand(
  context: CliContext,
  terminal: Terminal,
  workflowId: string,
): Promise<number> {
  const workflow = context
    .listWorkflows()
    .find((entry) => entry.workflowId === workflowId);

  if (workflow === undefined) {
    terminal.print(`Unknown workflow: ${workflowId}`);
    terminal.print();
    terminal.print("Run  designflow list  to see what is available.");
    return 1;
  }

  terminal.print(heading(workflow.name));
  terminal.print(workflow.description);
  terminal.print();

  const input = await collectInput(terminal, workflow);

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
    workflowId: workflow.workflowId,
    input,
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
  workflow: WorkflowInfo,
): Promise<Record<string, unknown>> {
  const fields = INPUT_FIELDS[workflow.workflowId] ?? [];
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
