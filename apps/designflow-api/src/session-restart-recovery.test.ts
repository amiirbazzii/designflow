// apps/designflow-api/src/session-restart-recovery.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiHost, type ApiHost } from "./host";
import { createRouter } from "./router";

/**
 * Proves the fix this stage exists for: `AgentSessionService`'s store used to
 * be `InMemorySessionStore` (see `host.ts`), so a session left
 * `waiting_for_user` was lost the moment the API process restarted — the one
 * piece of state everything else in this host already survived a restart for
 * (`api.test.ts`'s "persistence" suite proves executions, narration and
 * artifacts all do). `SqliteSessionStore` closes that gap.
 *
 * The scenario mirrors `clarification-resume-regression.test.ts` in
 * `designflow-cli`, but through the HTTP surface and against two separate
 * `ApiHost`s sharing one SQLite file, rather than one CLI context reused —
 * that is what actually simulates a process restart here, the same technique
 * `api.test.ts`'s own persistence suite already uses.
 */

const workspaces: string[] = [];
const openHosts: ApiHost[] = [];

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-session-restart-"));
  workspaces.push(dir);
  return join(dir, "test.sqlite");
}

afterEach(() => {
  for (const host of openHosts.splice(0)) host.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface JsonResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function post(host: ApiHost, path: string, body?: unknown): Promise<JsonResponse> {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });

  const response = await createRouter(host)(request);
  const parsed: unknown = await response.json();

  return {
    status: response.status,
    body: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {},
  };
}

async function get(host: ApiHost, path: string): Promise<JsonResponse> {
  const response = await createRouter(host)(new Request(`http://localhost${path}`));
  const parsed: unknown = await response.json();

  return {
    status: response.status,
    body: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {},
  };
}

describe("a clarification session survives an API process restart", () => {
  test("start -> restart -> resume -> completed", async () => {
    const path = databasePath();

    // First "process": a genuinely empty task body, the shape that leaves
    // the qa-reviewer worker with nothing to act on and forces a
    // clarification (the same trigger `api.test.ts` uses for "asks a
    // clarifying question").
    const first = createApiHost({ databasePath: path, requireApproval: false });
    const started = await post(first, "/workers/qa-reviewer/tasks", {});

    expect(started.status).toBe(201);
    const startedSession = started.body.session as Record<string, unknown>;
    expect(startedSession["status"]).toBe("waiting_for_user");
    const sessionId = startedSession["id"] as string;
    expect(typeof sessionId).toBe("string");

    // No explicit close: `ApiHost.close()` exists ("`close(): void`" in
    // `host.ts`), but the point of this test is that nothing kept in the
    // *process* — including any explicit shutdown step — is what makes the
    // session recoverable; only the file on disk is. Discard the host as if
    // the process had simply died.

    // Second "process": a fresh host against the same database file, nothing
    // carried over in memory.
    const second = createApiHost({ databasePath: path, requireApproval: false });
    openHosts.push(second);

    const fetched = await get(second, `/sessions/${sessionId}`);
    expect(fetched.status).toBe(200);
    const fetchedSession = fetched.body.session as Record<string, unknown>;
    expect(fetchedSession["id"]).toBe(sessionId);
    expect(fetchedSession["status"]).toBe("waiting_for_user");

    // Resume and answer through the restarted host.
    const answered = await post(second, `/sessions/${sessionId}/answers`, {
      answer: "Review src/components/Header.tsx for accessibility issues.",
    });

    expect(answered.status).toBe(200);
    const answeredSession = answered.body.session as Record<string, unknown>;
    expect(answeredSession["status"]).toBe("completed");
    expect(answeredSession["executionId"]).toBeDefined();
  });
});
