// apps/designflow-cli/src/commands/cleanup.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionClock } from "@designflow/product";
import { dispatch } from "../cli";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { ScriptedTerminal } from "../ui/terminal";

/**
 * `designflow cleanup` end to end, through the composition root — the same
 * pattern `clarification-resume-regression.test.ts` uses: a real
 * `createCliContext` against a temporary `DESIGNFLOW_HOME`, driven through
 * `dispatch` rather than by reaching for a concrete session or approval store
 * directly, so this exercises the actual wiring a person's terminal invokes.
 *
 * Covers the stage 42.5 guarantees: a stale `waiting_for_user` session is
 * persisted as `expired` (not merely reported as such), running the command
 * twice is a no-op the second time, and a `completed` session is never
 * touched regardless of how long ago it was created.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-cleanup-"));
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshHome(): string {
  const home = workspace();
  process.env.DESIGNFLOW_HOME = home;
  return home;
}

/**
 * A moment for session creation, then a moment long past any session's
 * default `expirationDays: 7` window, forever after.
 *
 * `readSessionConfig` refuses `expirationDays: 0` on purpose (a config typo
 * must not expire every session on arrival), so there is no way to make a
 * session stale *immediately* through config. Advancing the clock instead —
 * the same seam `session-service.test.ts`'s own `clock` helper is — reaches
 * the same place without needing config to cooperate.
 */
function clock(...timestamps: string[]): SessionClock {
  let index = 0;
  return {
    now: () => {
      const value = timestamps[Math.min(index, timestamps.length - 1)];
      index += 1;
      return value ?? timestamps[timestamps.length - 1] ?? new Date().toISOString();
    },
  };
}

const CREATED_AT = "2026-08-01T10:00:00.000Z";
const LONG_AFTER_EXPIRY = "2026-09-01T10:00:00.000Z";

describe("designflow cleanup", () => {
  test("persists `expired` onto a stale waiting_for_user session, and reports it", async () => {
    const home = freshHome();
    const databasePath = join(home, "runs.json");

    const context = createCliContext({
      databasePath,
      requireApproval: false,
      sessionClockOverride: clock(CREATED_AT, CREATED_AT, LONG_AFTER_EXPIRY),
    });
    contexts.push(context);

    // An empty request/input reliably produces a `request_clarification`
    // decision — the same shape `clarification-resume-regression.test.ts`
    // uses. The clock jumps to `LONG_AFTER_EXPIRY` on every call after
    // creation, well past the default `expirationDays: 7` window.
    const started = await context.sessions.startSession({
      workerId: "qa-reviewer",
      request: "",
      input: {},
    });
    expect(started.session.status).toBe("waiting_for_user");

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["cleanup"], context, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain(started.session.id);
    expect(terminal.transcript).toContain("Completed runs and history were left untouched.");

    const after = await context.sessions.getSession(started.session.id);
    expect(after.status).toBe("expired");
  });

  test("running cleanup twice is a no-op the second time", async () => {
    const home = freshHome();
    const databasePath = join(home, "runs.json");

    const context = createCliContext({
      databasePath,
      requireApproval: false,
      sessionClockOverride: clock(CREATED_AT, CREATED_AT, LONG_AFTER_EXPIRY),
    });
    contexts.push(context);

    await context.sessions.startSession({ workerId: "qa-reviewer", request: "", input: {} });

    const first = await context.cleanup();
    expect(first.expiredSessionIds).toHaveLength(1);

    const second = await context.cleanup();
    expect(second.expiredSessionIds).toEqual([]);
    expect(second.expiredApprovalIds).toEqual([]);

    const terminal = new ScriptedTerminal([]);
    await dispatch(["cleanup"], context, terminal);
    expect(terminal.transcript).toContain("Nothing to clean up. All sessions and approvals are current.");
  });

  test("never touches a completed session, even long past the expiration window", async () => {
    const home = freshHome();
    const databasePath = join(home, "runs.json");

    const context = createCliContext({
      databasePath,
      requireApproval: false,
      sessionClockOverride: clock(CREATED_AT, CREATED_AT, LONG_AFTER_EXPIRY),
    });
    contexts.push(context);

    // "design-engineer" with a real request/input resolves deterministically
    // to `run_workflow` rather than asking a clarifying question, so this
    // session reaches `completed` on its first turn.
    const started = await context.sessions.startSession({
      workerId: "design-engineer",
      request: "Build the login page header component.",
    });
    expect(started.session.status).toBe("completed");

    const report = await context.cleanup();
    expect(report.expiredSessionIds).not.toContain(started.session.id);

    const after = await context.sessions.getSession(started.session.id);
    expect(after.status).toBe("completed");
  });
});
