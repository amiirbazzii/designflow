// apps/designflow-cli/src/commands/cleanup.ts
import { heading, type Terminal } from "../ui/terminal";
import type { CliContext } from "../services/cli-runner";

/**
 * `designflow cleanup`.
 *
 * Manual, not scheduled — nothing in this CLI runs on a timer, so a stale
 * conversation or a pending approval nobody ever answered would otherwise sit
 * `waiting_for_user`/`pending` forever, readable as "someone might still act
 * on this" long after `expiresAt` says otherwise. This command is what
 * actually persists `expired` onto that stale state; `designflow sessions`
 * and `designflow answer` already *report* it as expired on every read
 * (`AgentSessionService.getSession`/`listSessions`), but nothing writes it
 * until this runs.
 *
 * Only ever touches transient, still-open state — a session past its
 * `expiresAt` that never got an answer, an approval past its `expiresAt`
 * nobody decided. It never deletes anything, and it never touches a
 * `completed` session, a decided approval, or any run history: pruning that
 * would be a separate, explicitly opt-in feature, not this command's job.
 *
 * Idempotent by construction — `CliContext.cleanup()` persists `expired`,
 * which is terminal, so a session or approval already marked is simply not
 * stale on the next call. Running this twice in a row is a safe no-op the
 * second time.
 */
export async function cleanupCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  const report = await context.cleanup();

  terminal.print(heading("Cleanup"));

  if (report.expiredSessionIds.length === 0 && report.expiredApprovalIds.length === 0) {
    terminal.print("Nothing to clean up. All sessions and approvals are current.");
    terminal.print();
    return 0;
  }

  if (report.expiredSessionIds.length > 0) {
    terminal.print(
      `Marked ${report.expiredSessionIds.length} conversation${plural(report.expiredSessionIds.length)} as expired — too long unanswered to resume:`,
    );
    for (const sessionId of report.expiredSessionIds) {
      terminal.print(`  ${sessionId}`);
    }
    terminal.print();
  }

  if (report.expiredApprovalIds.length > 0) {
    terminal.print(
      `Marked ${report.expiredApprovalIds.length} approval${plural(report.expiredApprovalIds.length)} as expired — too long undecided to authorize a run:`,
    );
    for (const approvalId of report.expiredApprovalIds) {
      terminal.print(`  ${approvalId}`);
    }
    terminal.print();
  }

  terminal.print("Completed runs and history were left untouched.");
  terminal.print();

  return 0;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
