// apps/designflow-cli/src/clarification-resume-regression.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "./cli";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import { ScriptedTerminal } from "./ui/terminal";

/**
 * Regression test for an adversarial-verification finding: a session started
 * with a genuinely empty request/input — reachable through the product API's
 * `POST /workers/:id/tasks` with an empty body, though never through the
 * CLI's own interactive form, which always fills a placeholder — could never
 * leave `waiting_for_user`. `AgentSessionService.answerSession` re-routes
 * using the session's *original* (empty) request/input; every deterministic
 * strategy's readiness gate checked only that original request/input, never
 * `task.context.clarifications`, so the same question was asked forever no
 * matter what was answered.
 *
 * Fixed by `readyToDecide` (`packages/agents/src/catalog/task-helpers.ts`,
 * and design-engineer-agent's own local copy) — the gate now also considers
 * a resumed session's clarification answer, and `describeTask`/`describe`
 * fall back to that answer as the effective request text.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-clarify-resume-"));
  workspaces.push(dir);
  return dir;
}

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ANSWERS: Record<string, string> = {
  "qa-reviewer": "Review src/components/Header.tsx for accessibility issues.",
  "product-manager": "Let existing CLI users export their run history as CSV.",
};

describe("a session with a genuinely empty original request resumes and completes", () => {
  for (const workerId of ["qa-reviewer", "product-manager"]) {
    test(`${workerId}: clarification, then a real process restart, then resolves`, async () => {
      const home = workspace();
      process.env.DESIGNFLOW_HOME = home;
      const databasePath = join(home, "runs.json");

      // First "process": start a session with nothing to act on at all —
      // the shape `POST /workers/:id/tasks` with an empty body produces,
      // never reachable through `designflow run`'s own placeholder-filling
      // form.
      const first = createCliContext({ databasePath, requireApproval: false });
      contexts.push(first);

      const started = await first.sessions.startSession({ workerId, request: "", input: {} });
      expect(started.session.status).toBe("waiting_for_user");
      expect(started.message).toBeDefined();
      expect(await first.runner.history()).toHaveLength(0);

      const sessionId = started.session.id;

      // A genuine restart: a fresh context against the same database file,
      // nothing carried over in memory.
      const second = createCliContext({ databasePath, requireApproval: false });
      contexts.push(second);

      const terminal = new ScriptedTerminal([ANSWERS[workerId] ?? ""]);
      const code = await dispatch(["answer", sessionId], second, terminal);

      expect(code).toBe(0);
      // The regression: before the fix, this printed the *same* clarifying
      // question again and the session stayed `waiting_for_user` forever.
      expect(terminal.transcript).toContain("Complete");

      const resumed = await second.sessions.getSession(sessionId);
      expect(resumed.status).toBe("completed");
      expect(resumed.executionId).toBeDefined();

      const history = await second.runner.history();
      expect(history).toHaveLength(1);
    });
  }
});
