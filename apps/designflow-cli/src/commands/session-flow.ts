// apps/designflow-cli/src/commands/session-flow.ts
import {
  heading,
  stepMarker,
  type Terminal,
} from "../ui/terminal";

import type { CliContext } from "../services/cli-runner";
import type { SessionResult } from "@designflow/sdk";

/**
 * What `designflow run` and `designflow answer` share once a session exists.
 *
 * Starting a session and resuming one differ only in how the first decision
 * is reached — everything after that first decision is the same: keep
 * clarifying while the person is willing to, then report what a completed,
 * declined, or otherwise closed session came to. Two commands sharing this
 * cannot render the same outcome two different ways.
 */

// ── Clarification ────────────────────────────────────────────────

/**
 * Answers a `request_clarification` decision inline, for as long as the
 * person stays at the terminal.
 *
 * Each loop is one resumed decision, bounded by the session's own turn
 * limit — enforced by `AgentSessionService`, not by a counter here. A
 * `terminal.ask` that cannot produce an answer — end of input, or `Ctrl+C` on
 * a real terminal — leaves the session exactly where it was: `waiting_for_user`,
 * resumable later with `designflow answer <session-id>`.
 *
 * Returns `null` when the session was left waiting rather than resolved, so
 * the caller can stop without treating an unanswered session as a failure.
 */
export async function clarify(
  context: CliContext,
  terminal: Terminal,
  workerName: string,
  result: SessionResult,
): Promise<SessionResult | null> {
  let current = result;

  while (current.session.status === "waiting_for_user") {
    terminal.print();
    terminal.print(heading(`${workerName} needs more information`));
    terminal.print(current.message ?? current.session.currentQuestion ?? "");
    terminal.print();
    terminal.print("Enter an answer now, or press Ctrl+C to continue later.");

    let answer: string;
    try {
      answer = await terminal.ask("Answer");
    } catch {
      return saveAndStop(terminal, current.session.id);
    }

    // A `Terminal` that has run out of input does not always throw the way
    // an interactive one does on `Ctrl+C` — piped, non-TTY stdin (a script,
    // a CI job) simply returns an empty string once its queued answers are
    // exhausted. Treated identically to the thrown case: the session is left
    // exactly where it was, resumable later, rather than handing an empty
    // string to `answerSession` and letting its own `.min(1)` validation
    // throw a raw schema error the person never asked to see.
    if (answer.trim().length === 0) {
      return saveAndStop(terminal, current.session.id);
    }

    current = await context.sessions.answerSession({
      sessionId: current.session.id,
      answer,
    });
  }

  return current;
}

function saveAndStop(terminal: Terminal, sessionId: string): null {
  terminal.print();
  terminal.print("Session saved.");
  terminal.print();
  terminal.print("Resume with:");
  terminal.print(`  designflow answer ${sessionId}`);
  terminal.print();
  return null;
}

// ── Outcome ─────────────────────────────────────────────────────

/** Renders whatever a session settled on: declined, completed, or otherwise closed. */
export async function finishSession(
  context: CliContext,
  terminal: Terminal,
  result: SessionResult,
): Promise<number> {
  if (result.session.status === "declined") {
    terminal.print();
    terminal.print(heading("Not started"));
    terminal.print(result.message ?? "");
    terminal.print();
    return 1;
  }

  if (result.session.status !== "completed" || result.session.executionId === undefined) {
    terminal.print();
    terminal.print(heading("Not started"));
    terminal.print("That could not be completed.");
    terminal.print();
    return 1;
  }

  const executionId = result.session.executionId;
  const approved = await resolveApproval(context, terminal, executionId);

  if (approved === false) {
    terminal.print();
    terminal.print("Stopped. Nothing was written.");
    return 1;
  }

  return report(context, terminal, executionId);
}

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

async function report(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
): Promise<number> {
  const result = await context.runner.explain(executionId);
  const { overview, artifacts } = result;

  terminal.print();
  terminal.print(heading(overview.state === "ready" ? "Complete" : "Stopped"));
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
  const named = artifacts.filter((artifact) => artifact.name !== artifact.artifactId);

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

// ── Progress ────────────────────────────────────────────────────

export function renderProgress(progress: {
  readonly completed: number;
  readonly total: number;
  readonly steps: readonly { readonly label: string; readonly status: string }[];
}): string {
  const lines = progress.steps.map((step) => `  ${stepMarker(step.status)} ${step.label}`);

  lines.push("", `  ${progress.completed} of ${progress.total} steps`);

  return lines.join("\n");
}

/** Attaches a live checklist for whichever `sessions` call ends up starting a workflow. */
export function watchProgress(context: CliContext, terminal: Terminal): void {
  let lastFrame = "";
  context.onProgress((progress) => {
    const frame = renderProgress(progress);
    if (frame === lastFrame) return;

    lastFrame = frame;
    terminal.print(frame);
  });
}
