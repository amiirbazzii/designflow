import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { doctorCommand } from "./doctor";
import { runCommand } from "./run";
import { ScriptedTerminal } from "../ui/terminal";

/**
 * `run`'s setup guidance and `doctor`'s readiness section are the same
 * sentences, because they are the same derivation. These tests assert that
 * equality directly — a wording that drifts in one command is what sent
 * people to the wrong fix before.
 */

const homes: string[] = [];
const contexts: CliContext[] = [];

function context(settings: Record<string, unknown> = {}): CliContext {
  const home = mkdtempSync(join(tmpdir(), "designflow-run-guidance-"));
  homes.push(home);
  process.env.DESIGNFLOW_HOME = home;

  writeFileSync(
    join(home, "config.json"),
    `${JSON.stringify({ version: 1, firstRunCompleted: true, environment: "local", databasePath: "history/runs.json", settings }, null, 2)}\n`,
  );

  const created = createCliContext({ databasePath: join(home, "runs.json") });
  contexts.push(created);
  return created;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
});

describe("run prerequisite guidance", () => {
  test("a missing Figma block asks for one to be added", async () => {
    const created = context();
    const terminal = new ScriptedTerminal();

    expect(await runCommand(created, terminal, "design-engineer")).toBe(1);
    expect(terminal.questions).toEqual([]);
    expect(terminal.transcript).toContain("No Figma connection is configured.");
    expect(terminal.transcript).toContain("Add a figmaMcp block");
    expect(terminal.transcript).toContain("Nothing was run and no files were changed.");
  });

  test("an unusable Figma block asks for it to be fixed, not added", async () => {
    const created = context({ figmaMcp: { transport: "stdio" } });
    const terminal = new ScriptedTerminal();

    expect(await runCommand(created, terminal, "design-engineer")).toBe(1);
    expect(terminal.transcript).toContain("does not describe a usable server");
    expect(terminal.transcript).toContain("Fix the figmaMcp block");
    expect(terminal.transcript).not.toContain("Add a figmaMcp block");
  });

  test("run and doctor say the same thing about the same broken configuration", async () => {
    const running = context({ figmaMcp: { transport: "stdio" } });
    const runTerminal = new ScriptedTerminal();
    await runCommand(running, runTerminal, "design-engineer");

    const doctorTerminal = new ScriptedTerminal();
    await doctorCommand(running, doctorTerminal);

    const sentence = "does not describe a usable server";
    expect(runTerminal.transcript).toContain(sentence);
    expect(doctorTerminal.transcript).toContain(sentence);
  });
});
