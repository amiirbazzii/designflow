import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../cli";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { ScriptedTerminal } from "../ui/terminal";

const homes: string[] = [];
const contexts: CliContext[] = [];

afterEach(() => {
  for (const context of contexts.splice(0)) context.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
  delete process.env.DESIGNFLOW_AI_GATEWAY_URL;
});

describe("designflow logout", () => {
  test("clears local auth state without printing the session", async () => {
    const home = mkdtempSync(join(tmpdir(), "designflow-logout-"));
    homes.push(home);
    process.env.DESIGNFLOW_HOME = home;
    process.env.DESIGNFLOW_AI_GATEWAY_URL = "https://project.supabase.co/functions/v1/ai-gateway";
    const created = createCliContext({ databasePath: join(home, "runs.json") });
    contexts.push(created);
    mkdirSync(created.home.layout.auth, { recursive: true });
    writeFileSync(created.home.layout.authSessionFile, JSON.stringify({
      version: 1,
      accessToken: "logout-access-secret",
      refreshToken: "logout-refresh-secret",
      expiresAt: Date.now() + 60_000,
    }));

    const terminal = new ScriptedTerminal();
    expect(await dispatch(["logout"], created, terminal)).toBe(0);
    expect(terminal.transcript).toContain("Signed out of DesignFlow AI");
    expect(terminal.transcript).not.toContain("logout-access-secret");
    expect(terminal.transcript).not.toContain("logout-refresh-secret");
    expect(() => readFileSync(created.home.layout.authSessionFile, "utf8")).toThrow();
  });
});
