// apps/designflow-cli/src/commands/session-flow.ts
import {
  heading,
  stepMarker,
  type Terminal,
} from "../ui/terminal";

import { EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID, type CliContext } from "../services/cli-runner";
import type { SessionResult } from "@designflow/sdk";
import type { ArtifactSummary } from "@designflow/product";
import { renderDetail, renderList } from "./artifacts";

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

/**
 * Renders whatever a session settled on: declined, completed, or otherwise
 * closed.
 *
 * `offerArtifactView` — the interactive "view artifacts now?" follow-up —
 * only runs when `interactive` is true. `designflow run <worker>` is a single
 * command whose scripted answers are exactly its declared input fields; the
 * interactive shell, which loops back to its own menu afterwards, is the only
 * caller that opts in.
 */
export async function finishSession(
  context: CliContext,
  terminal: Terminal,
  result: SessionResult,
  interactive = false,
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

  return report(context, terminal, executionId, interactive);
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
  const stage4 = pending.workflowId === EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID;
  if (stage4) {
    await renderImplementationPreview(context, terminal, executionId);
  } else {
    terminal.print("DesignFlow wants permission to:");
    terminal.print();
    terminal.print("  Store the generated result as a DesignFlow artifact");
    terminal.print("  (this does not change any file in your project)");
  }
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
  interactive: boolean,
): Promise<number> {
  const result = await context.runner.explain(executionId);
  const { overview, artifacts } = result;

  terminal.print();
  terminal.print(heading(overview.state === "ready" ? "Complete" : "Stopped"));
  terminal.print(overview.summary);

  if (overview.state !== "ready") {
    const validation = artifacts.find((artifact) => artifact.artifactId === "implementation-validation");
    if (validation !== undefined) {
      const detail = await context.artifactInspection.getPayload(validation);
      const payload = detail.payload as { checks?: Array<{ name: string; status: string }>; rollbackTriggered?: boolean };
      const failed = payload.checks?.find((check) => check.status === "failed");
      terminal.print();
      terminal.print(`Implementation validation failed${failed ? `: ${failed.name}` : "."}`);
      if (payload.rollbackTriggered) terminal.print("DesignFlow restored the project to its previous state.");
      terminal.print("No generated changes remain in the project.");
    }
    if (overview.failureReason !== undefined) {
      terminal.print(`Reason: ${overview.failureReason}`);
    }
    // Write-status honesty on the stopped path too: a rejected or otherwise
    // unfinished implementation must say plainly whether the project was
    // touched, derived from what actually ran — never from the workflow id.
    const applied = artifacts.some((artifact) => artifact.artifactId === "file-application-result");
    if (!applied) {
      terminal.print("No changes were applied to your project.");
    }
  }

  if (overview.durationLabel !== undefined) {
    terminal.print(`Took ${overview.durationLabel}.`);
  }

  // Write status is derived from what actually ran — the presence of the
  // application-result artifact — never from the command or workflow name.
  if (overview.state === "ready") {
    const implementation = artifacts.some((artifact) => artifact.artifactId === "file-application-result");
    const specification = artifacts.some((artifact) => artifact.artifactId === "design-specification" || artifact.artifactId === "stage-3-summary");
    if (implementation) {
      terminal.print("Project files were updated after your approval.");
    } else if (specification) {
      terminal.print("Design specification generated — no project files were written.");
    } else {
      terminal.print("Output stored as DesignFlow artifacts — no files were written to your project.");
    }
    const visual = artifacts.find((artifact) => artifact.artifactId === "stage-5-summary");
    if (visual !== undefined) {
      const detail = await context.artifactInspection.getPayload(visual);
      const payload = detail.payload as { overallStatus?: string; viewportCount?: number; critical?: number; major?: number; minor?: number; referenceMode?: string };
      terminal.print();
      terminal.print("Visual validation finished.");
      terminal.print(`Status: ${payload.overallStatus ?? "unknown"}`);
      terminal.print(`Viewports: ${payload.viewportCount ?? 0}`);
      terminal.print(`Critical: ${payload.critical ?? 0}`);
      terminal.print(`Major: ${payload.major ?? 0}`);
      terminal.print(`Minor: ${payload.minor ?? 0}`);
      terminal.print(`Reference mode: ${payload.referenceMode ?? "unknown"}`);
      terminal.print("No project files were changed during visual validation.");
      terminal.print("Automatic corrections have not been applied.");
    } else if (implementation) {
      terminal.print("Visual comparison has not been performed yet.");
    }
    if (implementation) terminal.print("A rollback snapshot is available.");
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

  if (overview.state === "ready" && named.length > 0) {
    terminal.print();
    terminal.print(`Inspect the result: designflow artifacts ${executionId}`);

    if (interactive) {
      await offerArtifactView(context, terminal, executionId, artifacts);
    }
  }

  terminal.print();
  terminal.print(`Run id: ${executionId}`);
  terminal.print();

  return overview.state === "ready" ? 0 : 1;
}

async function renderImplementationPreview(context: CliContext, terminal: Terminal, executionId: string): Promise<void> {
  const report = await context.runner.explain(executionId);
  const proposal = report.artifacts.find((artifact) => artifact.artifactId === "proposed-file-changes");
  terminal.print("DesignFlow wants permission to apply the proposed implementation to the registered project.");
  terminal.print();
  if (proposal !== undefined) {
    const detail = await context.artifactInspection.getPayload(proposal);
    const payload = detail.payload as { projectId?: string; files?: Array<{ path: string; action: string; reason: string }>; packageChanges?: Array<{ packageName: string }> };
    const files = Array.isArray(payload.files) ? payload.files : [];
    terminal.print(`Project: ${payload.projectId ?? "registered project"}`);
    terminal.print(`Files to create: ${files.filter((file) => file.action === "create").length}`);
    terminal.print(`Files to modify: ${files.filter((file) => file.action === "modify").length}`);
    terminal.print(`Dependencies: ${payload.packageChanges?.length ?? 0}`);
    terminal.print();
    terminal.print("No files have been changed yet.");
    terminal.print();
    for (const file of files.slice(0, 50)) terminal.print(`  ${file.action}  ${file.path} — ${file.reason}`);
    if (files.length > 50) terminal.print(`  … ${files.length - 50} more files omitted`);
  }
  terminal.print();
  terminal.print("A rollback snapshot will be created before changes are applied.");
  terminal.print("Validation commands will run after approval.");
}

/**
 * Lets someone at an interactive terminal look at what they just got, without
 * leaving the flow they are already in.
 *
 * Declining, or running with no interactive terminal behind it (an empty
 * answer, the same signal `clarify` above treats as "not answering"), moves
 * on exactly as if this were not offered at all — the printed
 * `designflow artifacts <id>` hint above remains the way to look later.
 */
async function offerArtifactView(
  context: CliContext,
  terminal: Terminal,
  executionId: string,
  artifacts: readonly ArtifactSummary[],
): Promise<void> {
  terminal.print();
  terminal.print("View artifacts now?");

  let viewMore: string;
  try {
    viewMore = await terminal.ask("View artifacts now?", ["yes", "no"]);
  } catch {
    return;
  }

  if (!viewMore.trim().toLowerCase().startsWith("y")) return;

  terminal.print();
  renderList(terminal, executionId, artifacts);

  terminal.print();
  terminal.print("Show which artifact? (id, or blank to finish)");

  let artifactId: string;
  try {
    artifactId = (
      await terminal.ask("Show which artifact? (id, or blank to finish)")
    ).trim();
  } catch {
    return;
  }

  if (artifactId.length === 0) return;

  const summary = artifacts.find((artifact) => artifact.artifactId === artifactId);

  if (summary === undefined) {
    terminal.print();
    terminal.print(`No artifact "${artifactId}" on this run.`);
    return;
  }

  const detail = await context.artifactInspection.getPayload(summary);
  terminal.print();
  renderDetail(terminal, detail.summary, detail.payload);
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
