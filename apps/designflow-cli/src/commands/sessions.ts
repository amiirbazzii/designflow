// apps/designflow-cli/src/commands/sessions.ts
import { formatWhen, heading } from "../ui/terminal";
import type { Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";
import type { AgentSession, SessionStatus } from "@designflow/sdk";
import { clarify, finishSession, watchProgress } from "./session-flow";

/**
 * `designflow sessions`, `designflow answer` and `designflow cancel`.
 *
 * The resumable half of a clarification. `run` shows a session's first turn
 * inline; these three commands are for the conversation that outlived that
 * one process — one to see what is waiting, one to answer it, one to end it.
 *
 * Rendered the same way `traces.ts` renders a trace: worker by *name*, never
 * by agent id or model profile id, and the session id shown because it is
 * what a person types to act on this one again.
 */

// ── List / detail ───────────────────────────────────────────────

export async function sessionsCommand(
  context: CliContext,
  terminal: Terminal,
  options?: { readonly sessionId?: string; readonly status?: SessionStatus },
): Promise<number> {
  if (options?.sessionId !== undefined) {
    const session = await getSessionOrNull(context, options.sessionId);

    if (session === null) {
      terminal.print(heading("Session"));
      terminal.print(`No session with that id: ${options.sessionId}`);
      terminal.print();
      terminal.print("Run  designflow sessions  to see the ones that do exist.");
      return 1;
    }

    terminal.print(heading("Session"));
    printDetail(terminal, context, session);
    return 0;
  }

  const status = options?.status ?? "waiting_for_user";
  const sessions = await context.sessions.listSessions({ status, limit: 20 });

  terminal.print(heading(status === "waiting_for_user" ? "Waiting for you" : `Sessions — ${describeStatus(status)}`));

  if (sessions.length === 0) {
    terminal.print(
      status === "waiting_for_user"
        ? "Nothing is waiting on you right now."
        : "No sessions with that status.",
    );
    terminal.print();
    return 0;
  }

  for (const session of sessions) {
    terminal.print();
    printSummary(terminal, context, session);
  }

  terminal.print();
  return 0;
}

function printSummary(terminal: Terminal, context: CliContext, session: AgentSession): void {
  terminal.print(`  ${workerName(context, session)}`);

  if (session.status === "waiting_for_user" && session.currentQuestion !== undefined) {
    terminal.print(`    Question: ${session.currentQuestion}`);
  }

  terminal.print(`    Status: ${describeStatus(session.status)}`);
  terminal.print(`    Created: ${formatWhen(Date.parse(session.createdAt))}`);
  terminal.print(`    Session: ${session.id}`);
}

function printDetail(terminal: Terminal, context: CliContext, session: AgentSession): void {
  terminal.print(`  ${workerName(context, session)}`);
  terminal.print(`  Status: ${describeStatus(session.status)}`);
  terminal.print(`  Created: ${formatWhen(Date.parse(session.createdAt))}`);
  terminal.print(`  Updated: ${formatWhen(Date.parse(session.updatedAt))}`);
  terminal.print(`  Turns used: ${session.turnCount}`);

  if (session.answers.length > 0) {
    terminal.print();
    terminal.print("  Answered so far");
    for (const answer of session.answers) {
      terminal.print(`    Q: ${answer.question}`);
      terminal.print(`    A: ${answer.answer}`);
    }
  }

  if (session.status === "waiting_for_user" && session.currentQuestion !== undefined) {
    terminal.print();
    terminal.print(`  Question: ${session.currentQuestion}`);
    terminal.print();
    terminal.print(`  Answer with  designflow answer ${session.id}`);
  }

  if (session.status === "declined" && session.declineReason !== undefined) {
    terminal.print();
    terminal.print(`  Reason: ${session.declineReason}`);
  }

  if (session.executionId !== undefined) {
    terminal.print();
    terminal.print(`  Run: ${session.executionId}`);
  }

  terminal.print();
  terminal.print(`  Session: ${session.id}`);
}

function describeStatus(status: SessionStatus): string {
  switch (status) {
    case "active":
      return "in progress";
    case "waiting_for_user":
      return "waiting for you";
    case "completed":
      return "completed";
    case "declined":
      return "declined";
    case "failed":
      return "stopped";
    case "cancelled":
      return "cancelled";
  }
}

function workerName(context: CliContext, session: AgentSession): string {
  return context.workers.getWorker(session.workerId)?.name ?? session.workerId;
}

async function getSessionOrNull(
  context: CliContext,
  sessionId: string,
): Promise<AgentSession | null> {
  try {
    return await context.sessions.getSession(sessionId);
  } catch {
    return null;
  }
}

// ── Answer ──────────────────────────────────────────────────────

export async function answerCommand(
  context: CliContext,
  terminal: Terminal,
  sessionId: string,
): Promise<number> {
  const session = await getSessionOrNull(context, sessionId);

  if (session === null) {
    terminal.print(`No session with that id: ${sessionId}`);
    terminal.print();
    terminal.print("Run  designflow sessions  to see the ones that do exist.");
    return 1;
  }

  if (session.status !== "waiting_for_user") {
    terminal.print(`That session is not waiting for an answer (${describeStatus(session.status)}).`);
    terminal.print();

    // "in progress" is the one status that is neither a normal terminal
    // outcome nor genuinely resumable — it means something interrupted the
    // conversation mid-turn (the process exited, or the previous decision
    // failed) after an answer or a decision was already recorded. There is
    // no way to pick that turn back up, but the session is not stuck forever:
    // cancelling it and starting fresh is always safe, so say so rather than
    // leaving a person staring at a dead end.
    if (session.status === "active") {
      terminal.print(`Run  designflow cancel ${sessionId}  and start again — nothing further can be resumed.`);
      terminal.print();
    }

    return 1;
  }

  const name = workerName(context, session);

  watchProgress(context, terminal);

  terminal.print(heading(`${name} needs more information`));
  terminal.print(session.currentQuestion ?? "");
  terminal.print();

  const answer = await terminal.ask("Answer");

  // A `Terminal` fed from piped, non-TTY stdin returns an empty string once
  // it runs out of input rather than throwing — checked here so that hits
  // `answerSessionRequestSchema`'s own `.min(1)` and produces a raw schema
  // error instead of a plain, safe message.
  if (answer.trim().length === 0) {
    terminal.print("No answer was given. The session is unchanged — nothing was lost.");
    terminal.print();
    terminal.print(`Resume with:  designflow answer ${sessionId}`);
    terminal.print();
    return 1;
  }

  const answered = await context.sessions.answerSession({ sessionId, answer });

  const result = await clarify(context, terminal, name, answered);
  if (result === null) return 1;

  return finishSession(context, terminal, result);
}

// ── Cancel ──────────────────────────────────────────────────────

export async function cancelCommand(
  context: CliContext,
  terminal: Terminal,
  sessionId: string,
): Promise<number> {
  const session = await getSessionOrNull(context, sessionId);

  if (session === null) {
    terminal.print(`No session with that id: ${sessionId}`);
    terminal.print();
    terminal.print("Run  designflow sessions  to see the ones that do exist.");
    return 1;
  }

  // Checked here rather than left to `cancelSession`'s own refusal, so the
  // common case — cancelling something already finished — reads as a plain
  // status rather than an error.
  if (session.status === "cancelled") {
    terminal.print(`That session was already cancelled: ${workerName(context, session)}`);
    terminal.print();
    return 1;
  }

  if (session.status !== "active" && session.status !== "waiting_for_user") {
    terminal.print(
      `That session already ${describeStatus(session.status)} — there is nothing left to cancel.`,
    );
    terminal.print();
    return 1;
  }

  const cancelled = await context.sessions.cancelSession({ sessionId });

  terminal.print(`Session cancelled: ${workerName(context, cancelled)}`);
  terminal.print();

  return 0;
}
