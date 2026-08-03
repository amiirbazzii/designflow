// apps/designflow-cli/src/commands/artifacts.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../cli";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { ScriptedTerminal } from "../ui/terminal";

/**
 * `designflow artifacts` — real CLI behaviour against a throwaway home.
 *
 * Same discipline as `cli.test.ts`: drives `dispatch` the way a person would,
 * against a real file-backed store, asserting on what would have been
 * printed. Nothing here mocks the engine or the artifact store.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];

function context(options?: { readonly requireApproval?: boolean }): CliContext {
  const home = mkdtempSync(join(tmpdir(), "designflow-artifacts-"));
  workspaces.push(home);
  process.env.DESIGNFLOW_HOME = home;

  const created = createCliContext({
    databasePath: join(home, "runs.json"),
    requireApproval: false,
    ...options,
  });
  contexts.push(created);
  return created;
}

const RUN_ANSWERS = [
  "homepage.fig",
  "react",
  "brand/Header, brand/Footer, layout/Dashboard",
];

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
});

async function runDesignEngineer(cliContext: CliContext): Promise<string> {
  const terminal = new ScriptedTerminal(RUN_ANSWERS);
  const code = await dispatch(["run", "design-engineer"], cliContext, terminal);
  expect(code).toBe(0);

  const match = terminal.transcript.match(/Run id: (\S+)/);
  if (match?.[1] === undefined) throw new Error("no run id in transcript");
  return match[1];
}

describe("designflow artifacts", () => {
  test("lists the artifacts a run produced", async () => {
    const cliContext = context();
    const runId = await runDesignEngineer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["artifacts", runId], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain(`Run: ${runId}`);
    expect(terminal.transcript).toContain("Design analysis");
    expect(terminal.transcript).toContain("Generated source code");
    expect(terminal.transcript).toContain("(created)");
    expect(terminal.transcript).toContain(`designflow artifacts ${runId} <artifact-id>`);
  });

  test("shows a source-code artifact's files and states no project files changed", async () => {
    const cliContext = context();
    const runId = await runDesignEngineer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["artifacts", runId, "source-code"], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Stored internally by DesignFlow.");
    expect(terminal.transcript).toContain("No project files were changed.");
    expect(terminal.transcript).toContain("Framework: react");
    expect(terminal.transcript).toContain("src/components/Header.tsx");
    expect(terminal.transcript).toContain("export function Header()");
  });

  test("shows a validation-report artifact as readable JSON", async () => {
    const cliContext = context();
    const runId = await runDesignEngineer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(
      ["artifacts", runId, "validation-report"],
      cliContext,
      terminal,
    );

    expect(code).toBe(0);
    expect(terminal.transcript).toContain('"passed": true');
    expect(terminal.transcript).toContain('"checked": 3');
  });

  test("distinguishes a reused artifact from a created one on a second, identical run", async () => {
    const cliContext = context();
    await runDesignEngineer(cliContext);
    const secondRunId = await runDesignEngineer(cliContext);

    const terminal = new ScriptedTerminal([]);
    await dispatch(["artifacts", secondRunId], cliContext, terminal);

    expect(terminal.transcript).toContain("(reused)");

    const detailTerminal = new ScriptedTerminal([]);
    await dispatch(["artifacts", secondRunId, "design-analysis"], cliContext, detailTerminal);
    expect(detailTerminal.transcript).toContain("Status: reused");
  });

  test("reports an unknown run id rather than crashing", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal([]);

    const code = await dispatch(["artifacts", "no-such-run"], cliContext, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No run with that id: no-such-run");
  });

  test("reports an unknown artifact id on a real run", async () => {
    const cliContext = context();
    const runId = await runDesignEngineer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["artifacts", runId, "no-such-artifact"], cliContext, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain('No artifact "no-such-artifact"');
  });

  test("prints usage when no run id is given", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal([]);

    const code = await dispatch(["artifacts"], cliContext, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("Usage: designflow artifacts <run-id> [artifact-id]");
  });

  test("does not disturb designflow history", async () => {
    const cliContext = context();
    await runDesignEngineer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["history"], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Design → Code");
  });
});

describe("interactive artifact inspection", () => {
  test("offers to view artifacts after a completed run, and shows the chosen one", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal([
      "1",
      "",
      ...RUN_ANSWERS,
      "yes",
      "design-analysis",
      "4",
    ]);

    const code = await dispatch([], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("View artifacts now?");
    expect(terminal.transcript).toContain("Show which artifact?");
    expect(terminal.transcript).toContain("Stored internally by DesignFlow.");
    expect(terminal.transcript).toContain("No project files were changed.");
  });

  test("declining the offer leaves the completion screen exactly as before", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal(["1", "", ...RUN_ANSWERS, "no", "4"]);

    const code = await dispatch([], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("View artifacts now?");
    expect(terminal.transcript).not.toContain("Show which artifact?");
  });

  test("the direct `designflow run` command never asks to view artifacts", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    const code = await dispatch(["run", "design-engineer"], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).not.toContain("View artifacts now?");
    expect(terminal.transcript).toContain("Inspect the result: designflow artifacts");
  });
});
