// apps/designflow-cli/src/commands/artifacts.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../cli";
import { createCliContext, type CliContext } from "../services/cli-runner";
import { ScriptedTerminal } from "../ui/terminal";
import { runCommand } from "./run";

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

/**
 * Answers for the QA Reviewer form.
 *
 * QA Reviewer is this suite's generic worker: it completes deterministically
 * offline, so every assertion below is made against artifacts a real run
 * produced. Design Engineer can no longer play that part — it requires a
 * connected Figma design, which this suite does not configure.
 */
const RUN_ANSWERS = [
  "src/components/Header.tsx",
  "accessibility",
  "major",
];

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
});

async function runQaReviewer(cliContext: CliContext): Promise<string> {
  const terminal = new ScriptedTerminal(RUN_ANSWERS);
  const code = await dispatch(["run", "qa-reviewer"], cliContext, terminal);
  expect(code).toBe(0);

  const match = terminal.transcript.match(/Run id: (\S+)/);
  if (match?.[1] === undefined) throw new Error("no run id in transcript");
  return match[1];
}

describe("designflow artifacts", () => {
  test("lists the artifacts a run produced", async () => {
    const cliContext = context();
    const runId = await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["artifacts", runId], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain(`Run: ${runId}`);
    expect(terminal.transcript).toContain("Review target summary");
    expect(terminal.transcript).toContain("QA report");
    expect(terminal.transcript).toContain("(created)");
    expect(terminal.transcript).toContain(`designflow artifacts ${runId} <artifact-id>`);
  });

  test("shows an artifact's contents and says where it is kept", async () => {
    const cliContext = context();
    const runId = await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(
      ["artifacts", runId, "review-target-summary"],
      cliContext,
      terminal,
    );

    expect(code).toBe(0);
    // Where the artifact lives is the honest, unconditional fact. Whether a
    // run touched the project is a claim only the run itself can make, so the
    // detail view no longer asserts it on every artifact.
    expect(terminal.transcript).toContain("Stored internally by DesignFlow.");
    expect(terminal.transcript).not.toContain("No project files were changed.");
    expect(terminal.transcript).toContain("Status: created");
    expect(terminal.transcript).toContain("src/components/Header.tsx");
  });

  test("shows a report artifact as readable JSON", async () => {
    const cliContext = context();
    const runId = await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(
      ["artifacts", runId, "qa-report"],
      cliContext,
      terminal,
    );

    expect(code).toBe(0);
    expect(terminal.transcript).toContain('"verdict": "fail"');
    expect(terminal.transcript).toContain('"issueCount": 1');
  });

  test("distinguishes a reused artifact from a created one on a second, identical run", async () => {
    const cliContext = context();
    await runQaReviewer(cliContext);
    const secondRunId = await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    await dispatch(["artifacts", secondRunId], cliContext, terminal);

    expect(terminal.transcript).toContain("(reused)");

    const detailTerminal = new ScriptedTerminal([]);
    await dispatch(
      ["artifacts", secondRunId, "review-target-summary"],
      cliContext,
      detailTerminal,
    );
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
    const runId = await runQaReviewer(cliContext);

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

  test("names the producer of each artifact without claiming an agent ran", async () => {
    const cliContext = context();
    const runId = await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    await dispatch(["artifacts", runId], cliContext, terminal);

    // Every step of this run is deterministic, so no line may read as a
    // person's work, and no raw capability id may reach the terminal.
    expect(terminal.transcript).toContain("(deterministic step)");
    expect(terminal.transcript).not.toContain("Specialist");
  });

  test("shows no related executions for a run that composed none", async () => {
    const cliContext = context();
    const runId = await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    await dispatch(["artifacts", runId], cliContext, terminal);

    // Relationship comes from persisted lineage alone. A run that composed
    // nothing must not borrow a neighbour from history.
    expect(terminal.transcript).not.toContain("Related executions");
  });

  test("the detail view says how an artifact was produced, or that it was not recorded", async () => {
    const cliContext = context();
    const runId = await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    await dispatch(["artifacts", runId, "qa-report"], cliContext, terminal);

    expect(terminal.transcript).toMatch(
      /Produced by: .+|Producer details: not recorded in this artifact version\./,
    );
  });

  test("does not disturb designflow history", async () => {
    const cliContext = context();
    await runQaReviewer(cliContext);

    const terminal = new ScriptedTerminal([]);
    const code = await dispatch(["history"], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("QA Review");
  });
});

describe("artifact inspection after a run", () => {
  test("offers to view artifacts after a completed run, and shows the chosen one", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal([
      ...RUN_ANSWERS,
      "yes",
      "review-target-summary",
      "4",
    ]);

    const code = await runCommand(cliContext, terminal, "qa-reviewer", {
      interactive: true,
      offerArtifactView: true,
    });

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("View artifacts now?");
    expect(terminal.transcript).toContain("Show which artifact?");
    expect(terminal.transcript).toContain("Stored internally by DesignFlow.");
  });

  test("declining the offer leaves the completion screen exactly as before", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal([...RUN_ANSWERS, "no"]);

    const code = await runCommand(cliContext, terminal, "qa-reviewer", {
      interactive: true,
      offerArtifactView: true,
    });

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("View artifacts now?");
    expect(terminal.transcript).not.toContain("Show which artifact?");
  });

  test("the direct `designflow run` command never asks to view artifacts", async () => {
    const cliContext = context();
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    const code = await dispatch(["run", "qa-reviewer"], cliContext, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).not.toContain("View artifacts now?");
    expect(terminal.transcript).toContain("Inspect the result: designflow artifacts");
  });
});
