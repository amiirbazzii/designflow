// apps/designflow-demo/src/app.ts
import type { ExecutionHandle, ExecutionReport } from "@designflow/product";
import { DEMO_WORKFLOWS, findWorkflow, type DemoWorkflow } from "./catalog";
import type { DemoHost } from "./host";
import type { DemoIO } from "./io";
import {
  renderApproval,
  renderApprovalOutcome,
  renderCompletion,
  renderExplanation,
  renderInputHeading,
  renderInputSummary,
  renderLanding,
  renderProgress,
} from "./screens";

/**
 * The demo journey: choose → describe → watch → approve → understand.
 *
 * Imports `@designflow/product` and nothing else from the platform. Every
 * number it shows, every step in its checklist and every line of its summary
 * comes from `WorkflowRunner`, so the demo cannot drift from what the engine
 * actually did — there is no second source to drift from.
 */

export interface DemoResult {
  readonly workflowId: string;
  readonly executionId: string;
  readonly state: ExecutionHandle["state"];
  readonly approved: boolean | undefined;
  readonly report: ExecutionReport | undefined;
}

export interface RunDemoOptions {
  /** Pre-selects a workflow, skipping the landing prompt. */
  readonly workflowId?: string;
}

export async function runDemo(
  host: DemoHost,
  io: DemoIO,
  options?: RunDemoOptions,
): Promise<DemoResult> {
  const workflow = await selectWorkflow(io, options?.workflowId);
  const input = await collectInput(io, workflow);

  const execution = await startWithProgress(host, io, workflow, input);

  const approved = await resolveApproval(host, io, execution);

  const report = await host.runner.explain(execution.executionId);
  io.print("");
  io.print(renderCompletion(report));
  io.print("");
  io.print(renderExplanation(report));

  return {
    workflowId: workflow.workflowId,
    executionId: execution.executionId,
    state: report.overview.state,
    approved,
    report,
  };
}

// ── Step 1: choose ───────────────────────────────────────────────

async function selectWorkflow(
  io: DemoIO,
  preselected: string | undefined,
): Promise<DemoWorkflow> {
  if (preselected !== undefined) {
    const chosen = findWorkflow(preselected);
    if (chosen === undefined) {
      throw new Error(`Unknown workflow: ${preselected}`);
    }
    return chosen;
  }

  io.print(renderLanding(DEMO_WORKFLOWS));

  const answer = await io.ask(
    "Start which workflow?",
    DEMO_WORKFLOWS.map((entry) => entry.name),
  );

  const byIndex = DEMO_WORKFLOWS[Number(answer) - 1];
  const chosen =
    byIndex ??
    DEMO_WORKFLOWS.find(
      (entry) =>
        entry.workflowId === answer.trim() ||
        entry.name.toLowerCase() === answer.trim().toLowerCase(),
    );

  if (chosen === undefined) {
    throw new Error(`Unknown workflow: ${answer}`);
  }

  return chosen;
}

// ── Step 2: describe ─────────────────────────────────────────────

async function collectInput(
  io: DemoIO,
  workflow: DemoWorkflow,
): Promise<Record<string, unknown>> {
  io.print("");
  io.print(renderInputHeading(workflow));

  const input: Record<string, unknown> = {};

  for (const field of workflow.fields) {
    const answer = await io.ask(
      `${field.label} (${field.placeholder})`,
      field.choices,
    );

    // An empty answer takes the placeholder, so a reader can press through the
    // whole form and still get a working run.
    const value = answer.trim().length > 0 ? answer.trim() : field.placeholder;

    input[field.key] = field.list === true ? splitList(value) : value;
  }

  io.print(renderInputSummary(input));

  return input;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ── Step 3: watch ────────────────────────────────────────────────

/**
 * Starts the run, redrawing the checklist as each step lands.
 *
 * `WorkflowRunner.start` settles when the engine settles, but events are
 * published *during* that await — so subscribing before the call is what makes
 * the progress genuinely live rather than a single frame after the fact.
 */
async function startWithProgress(
  host: DemoHost,
  io: DemoIO,
  workflow: DemoWorkflow,
  input: Record<string, unknown>,
): Promise<ExecutionHandle> {
  let lastFrame = "";

  host.onProgress((_executionId, progress) => {
    const frame = renderProgress(workflow.name, progress);
    if (frame === lastFrame) return;

    lastFrame = frame;
    if (io.redraw !== undefined) io.redraw(frame);
  });

  io.print("");

  const execution = await host.runner.start({
    workflowId: workflow.workflowId,
    input: workflow.toInput?.(input) ?? input,
  });

  // A final frame from the runner itself, so the checklist reflects the
  // settled state rather than the last event that happened to fire.
  const progress = await host.runner.progress(execution.executionId);
  io.print(renderProgress(workflow.name, progress));

  return execution;
}

// ── Step 4: approve ──────────────────────────────────────────────

async function resolveApproval(
  host: DemoHost,
  io: DemoIO,
  execution: ExecutionHandle,
): Promise<boolean | undefined> {
  const pending = await host.runner.pendingApproval(execution.executionId);
  if (pending === null) return undefined;

  io.print("");
  io.print(renderApproval(pending));

  const answer = await io.ask("Approve?", ["approve", "reject"]);
  const approved = answer.trim().toLowerCase().startsWith("a");

  const outcome = approved
    ? await host.runner.approve(execution.executionId, "approved in demo")
    : await host.runner.reject(execution.executionId, "rejected in demo");

  io.print(renderApprovalOutcome(outcome));

  if (approved) {
    // The approved run continued to completion; show where it ended up.
    const progress = await host.runner.progress(execution.executionId);
    io.print("");
    io.print(renderProgress(execution.workflowName, progress));
  }

  return approved;
}
