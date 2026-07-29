// apps/designflow-cli/src/cli.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch, CLI_VERSION } from "./cli";
import { createCliContext } from "./services/cli-runner";
import type { CliContext } from "./services/cli-runner";
import { ScriptedTerminal } from "./ui/terminal";
import {
  configSchema,
  loadConfig,
  resolveDatabasePath,
  saveConfig,
} from "./services/config";

/**
 * CLI behaviour tests.
 *
 * Each drives `dispatch` the way a person would drive the binary, against a
 * real SQLite file, and asserts on what would have been printed. No command is
 * stubbed and no engine call is mocked.
 */

// ── Harness ─────────────────────────────────────────────────────

const workspaces: string[] = [];
const contexts: CliContext[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-cli-"));
  workspaces.push(dir);
  return dir;
}

function context(options?: { readonly requireApproval?: boolean }): CliContext {
  const created = createCliContext({
    databasePath: join(workspace(), "runs.sqlite"),
    ...options,
  });
  contexts.push(created);
  return created;
}

/** Answers for the design-to-code form, then a decision. */
const RUN_ANSWERS = [
  "homepage.fig",
  "react",
  "brand/Header, brand/Footer, layout/Dashboard",
];

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.DESIGNFLOW_HOME;
});

// ── 1. CLI starts successfully ──────────────────────────────────

describe("starting the CLI", () => {
  test("greets the user and offers actions", async () => {
    const terminal = new ScriptedTerminal(["3"]);

    const code = await dispatch([], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Welcome to DesignFlow");
    expect(terminal.transcript).toContain(
      "AI workflows that turn ideas into results.",
    );
    expect(terminal.transcript).toContain("1. Hire a worker");
    expect(terminal.transcript).toContain("2. View history");
    expect(terminal.transcript).toContain("3. Exit");
  });

  test("exits cleanly", async () => {
    const terminal = new ScriptedTerminal(["3"]);

    expect(await dispatch([], context(), terminal)).toBe(0);
    expect(terminal.transcript).toContain("Goodbye.");
  });

  test("returns to the menu after an action", async () => {
    const terminal = new ScriptedTerminal(["2", "3"]);

    await dispatch([], context(), terminal);

    // The session is a place to work, not a single command.
    const menus = terminal.output.filter((line) =>
      line.includes("1. Hire a worker"),
    );
    expect(menus.length).toBeGreaterThan(1);
  });

  test("reports an unrecognised menu choice without exiting", async () => {
    const terminal = new ScriptedTerminal(["9", "3"]);

    expect(await dispatch([], context(), terminal)).toBe(0);
    expect(terminal.transcript).toContain("Not an option: 9");
  });
});

// ── 2. `designflow list` returns workflows ──────────────────────

describe("designflow list", () => {
  test("shows AI workers, not workflows", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["list"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Available AI Workers");
    expect(terminal.transcript).toContain("Design Engineer");
    expect(terminal.transcript).toContain(
      "Transforms designs into production-ready applications",
    );
  });

  test("never shows a workflow id", async () => {
    const terminal = new ScriptedTerminal();

    await dispatch(["list"], context(), terminal);

    // A person hires a Design Engineer; that it runs a design-to-code pipeline
    // is an implementation detail they should not have to learn.
    expect(terminal.transcript).not.toContain("design-to-code");
    expect(terminal.transcript).not.toContain("Design → Code");
  });

  test("tells the reader how to start each worker", async () => {
    const terminal = new ScriptedTerminal();

    await dispatch(["list"], context(), terminal);

    expect(terminal.transcript).toContain("designflow run design-engineer");
  });

  test("groups workers by category", async () => {
    const terminal = new ScriptedTerminal();

    await dispatch(["list"], context(), terminal);

    expect(terminal.transcript).toContain("development");
  });
});

// ── 3. `designflow run` starts a workflow ───────────────────────

describe("designflow run", () => {
  test("runs a workflow to completion through the product layer", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    const code = await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Complete");
    expect(terminal.transcript).toContain("Created  5");
  });

  test("asks for each declared input field", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.questions).toEqual([
      "Design file (homepage.fig)",
      "Framework (react)",
      "Frames (comma separated) (brand/Header, brand/Footer, layout/Dashboard)",
    ]);
  });

  test("shows the checklist as steps land", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("✓ Analyze design");
    expect(terminal.transcript).toContain("✓ Validate output");
    expect(terminal.transcript).toContain("5 of 5 steps");
  });

  test("lists what the run produced", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("Design tokens");
    expect(terminal.transcript).toContain("from Design analysis");
  });

  test("asks for approval when the workflow is gated", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS, "approve"]);

    const code = await dispatch(["run", "design-engineer"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Approval required");
    expect(terminal.transcript).toContain("Generate production files");
  });

  test("rejecting stops the run and reports a failure exit code", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS, "reject"]);

    const code = await dispatch(["run", "design-engineer"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("Stopped. Nothing was written.");
  });

  test("falls back to placeholders for blank answers", async () => {
    const terminal = new ScriptedTerminal(["", "", ""]);

    const code = await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    // Pressing through the form still produces a working run.
    expect(code).toBe(0);
  });

  test("rejects an unknown worker", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["run", "nonsense"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No such worker: nonsense");
    expect(terminal.transcript).toContain("designflow list");
  });

  test("explains itself when no worker is named", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["run"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("designflow run design-engineer");
  });
});

// ── 4. `designflow history` shows previous executions ───────────

describe("designflow history", () => {
  test("says so when nothing has run", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["history"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Nothing has run yet.");
  });

  test("lists a completed run", async () => {
    const created = context({ requireApproval: false });

    await dispatch(
      ["run", "design-engineer"],
      created,
      new ScriptedTerminal(RUN_ANSWERS),
    );

    const terminal = new ScriptedTerminal();
    await dispatch(["history"], created, terminal);

    expect(terminal.transcript).toContain("Design → Code");
    expect(terminal.transcript).toContain("completed");
    expect(terminal.transcript).toContain("finished — created 5 artifacts");
  });

  test("survives the process that produced it", async () => {
    const databasePath = join(workspace(), "runs.sqlite");

    // First "invocation".
    const first = createCliContext({ databasePath, requireApproval: false });
    await dispatch(
      ["run", "design-engineer"],
      first,
      new ScriptedTerminal(RUN_ANSWERS),
    );
    first.close();

    // Second "invocation": a new process would share nothing but the file.
    const second = createCliContext({ databasePath, requireApproval: false });
    contexts.push(second);

    const terminal = new ScriptedTerminal();
    await dispatch(["history"], second, terminal);

    // Every CLI command is its own process, so without this the command could
    // only ever report on runs from its own lifetime.
    expect(terminal.transcript).toContain("Design → Code");
    expect(terminal.transcript).not.toContain("Nothing has run yet.");
  });

  test("can be narrowed to one workflow", async () => {
    const created = context({ requireApproval: false });
    await dispatch(
      ["run", "design-engineer"],
      created,
      new ScriptedTerminal(RUN_ANSWERS),
    );

    const terminal = new ScriptedTerminal();
    await dispatch(["history", "design-to-code"], created, terminal);

    expect(terminal.transcript).toContain("Design → Code");
  });
});

// ── 5. No forbidden engine imports ──────────────────────────────

describe("architecture", () => {
  const FORBIDDEN = [
    "@designflow/core",
    "@designflow/storage-sqlite",
    "@designflow/artifacts",
    "@designflow/state",
  ];

  function sources(dir: string): string[] {
    const found: string[] = [];

    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);

      if (statSync(path).isDirectory()) {
        found.push(...sources(path));
        continue;
      }

      if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        found.push(path);
      }
    }

    return found;
  }

  test("only the composition root touches the engine", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("services/cli-runner.ts")) continue;

      const contents = readFileSync(path, "utf8");

      for (const pkg of FORBIDDEN) {
        if (contents.includes(pkg)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${pkg}`);
        }
      }
    }

    // Wiring has to happen somewhere; confining it to one file is what keeps
    // "the CLI consumes DesignFlow" true of the application.
    expect(offenders).toEqual([]);
  });

  test("commands and rendering speak only the product layer", () => {
    const commandSources = sources(join(import.meta.dir, "commands")).concat(
      sources(join(import.meta.dir, "ui")),
    );

    expect(commandSources.length).toBeGreaterThan(0);

    for (const path of commandSources) {
      const contents = readFileSync(path, "utf8");
      expect(contents).not.toContain("@designflow/core");
    }
  });

  test("terminal rendering is kept out of the product logic", () => {
    const runner = readFileSync(
      join(import.meta.dir, "services", "cli-runner.ts"),
      "utf8",
    );

    // The composition root wires; it does not print.
    expect(runner).not.toContain("console.");
    expect(runner).not.toContain("process.stdout");
  });
});

// ── 6. Command parsing ──────────────────────────────────────────

describe("command parsing", () => {
  test("prints usage for --help", async () => {
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["--help"], context(), terminal)).toBe(0);
    expect(terminal.transcript).toContain("designflow list");
    expect(terminal.transcript).toContain("designflow run <worker>");
    expect(terminal.transcript).toContain("designflow history");
  });

  test("accepts -h and help as aliases", async () => {
    for (const flag of ["-h", "help"]) {
      const terminal = new ScriptedTerminal();
      expect(await dispatch([flag], context(), terminal)).toBe(0);
      expect(terminal.transcript).toContain("Usage:");
    }
  });

  test("prints the version", async () => {
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["--version"], context(), terminal)).toBe(0);
    expect(terminal.transcript.trim()).toBe(CLI_VERSION);
  });

  test("rejects an unknown command with usage", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["frobnicate"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("Unknown command: frobnicate");
    expect(terminal.transcript).toContain("Usage:");
  });

  test("no arguments means interactive mode", async () => {
    const terminal = new ScriptedTerminal(["3"]);

    await dispatch([], context(), terminal);

    expect(terminal.transcript).toContain("Welcome to DesignFlow");
  });
});

// ── Configuration ───────────────────────────────────────────────

describe("configuration", () => {
  test("defaults when no file exists", () => {
    process.env.DESIGNFLOW_HOME = workspace();

    const config = loadConfig();

    expect(config.environment).toBe("local");
    expect(config.version).toBe(1);
    expect(config.settings).toEqual({});
  });

  test("round-trips through ~/.designflow/config.json", () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;

    saveConfig(configSchema.parse({ environment: "staging" }));

    expect(existsSync(join(home, "config.json"))).toBe(true);
    expect(loadConfig().environment).toBe("staging");
  });

  test("falls back to defaults for a malformed file", () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;

    Bun.write(join(home, "config.json"), "{ not json");

    // A broken config should not stop someone running a workflow.
    expect(loadConfig().environment).toBe("local");
  });

  test("resolves a relative database path against the config home", () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;

    const config = configSchema.parse({ databasePath: "runs.sqlite" });

    expect(resolveDatabasePath(config)).toBe(join(home, "runs.sqlite"));
  });

  test("leaves an absolute database path alone", () => {
    const config = configSchema.parse({ databasePath: "/tmp/explicit.sqlite" });

    expect(resolveDatabasePath(config)).toBe("/tmp/explicit.sqlite");
  });
});

describe("configuration on first use", () => {
  test("writes a default config file so it can be discovered and edited", () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;

    createCliContext({
      databasePath: join(home, "runs.sqlite"),
    }).close();

    // Configuration support that only reads is not support: the file has to
    // exist before anyone can change it.
    expect(existsSync(join(home, "config.json"))).toBe(true);
    expect(loadConfig().environment).toBe("local");
  });
});

// ── Worker resolution ───────────────────────────────────────────

describe("worker resolution", () => {
  test("a worker resolves to the workflow it wraps", () => {
    const resolved = context().resolve("design-engineer");

    expect(resolved?.worker.id).toBe("design-engineer");
    expect(resolved?.workflowId).toBe("design-to-code");
    expect(resolved?.steps).toBe(5);
  });

  test("an unknown name resolves to nothing", () => {
    expect(context().resolve("nobody")).toBeNull();
  });

  test("a workflow id still resolves, so nothing is unreachable", () => {
    const resolved = context().resolve("design-to-code");

    // Workflow ids are no longer *shown*, but a workflow with no worker
    // wrapping it would otherwise be impossible to run.
    expect(resolved?.workflowId).toBe("design-to-code");
    expect(resolved?.worker.id).toBe("design-engineer");
  });

  test("running by workflow id teaches the worker's name", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "design-to-code"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain(
      "(design-to-code is a workflow — its worker is design-engineer)",
    );
  });

  test("running by worker name says nothing about workflows", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("Design Engineer");
    expect(terminal.transcript).not.toContain("is a workflow");
  });

  test("the catalogue is reachable from the CLI context", () => {
    const workers = context().workers.listWorkers();

    expect(workers.map((worker) => worker.id)).toEqual(["design-engineer"]);
  });
});

// ── Running a worker executes the right workflow ─────────────────

describe("running a worker", () => {
  test("executes the workflow the worker names", async () => {
    const created = context({ requireApproval: false });
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(["run", "design-engineer"], created, terminal);

    // The run is recorded against the workflow, not the worker: workers are a
    // naming layer, and the engine never learns they exist.
    const history = await created.runner.history();

    expect(history).toHaveLength(1);
    expect(history[0]?.workflowId).toBe("design-to-code");
    expect(history[0]?.state).toBe("ready");
  });

  test("asks for the fields the worker's manifest declares", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    // The questions come from the manifest, so adding a worker adds no code to
    // the run command.
    expect(terminal.questions).toEqual([
      "Design file (homepage.fig)",
      "Framework (react)",
      "Frames (comma separated) (brand/Header, brand/Footer, layout/Dashboard)",
    ]);
  });

  test("produces the workflow's artifacts", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "design-engineer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("Design tokens");
    expect(terminal.transcript).toContain("Created  5");
  });

  test("reports a worker whose workflow is not installed", async () => {
    const created = context();
    created.workers.registerWorker({
      id: "ghost-worker",
      name: "Ghost",
      description: "Names a workflow that is not installed",
      category: "testing",
      workflows: ["not-installed"],
      inputs: [],
    });

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["run", "ghost-worker"], created, terminal);

    // A configuration problem named precisely, rather than an
    // ERR_WORKFLOW_NOT_FOUND stack trace from under the engine.
    expect(code).toBe(1);
    expect(terminal.transcript).toContain(
      'Ghost needs the "not-installed" workflow, which is not installed.',
    );
  });
});

// ── The CLI does not bypass WorkflowRunner ──────────────────────

describe("execution boundary", () => {
  test("every command call goes through WorkflowRunner", () => {
    const commandDir = join(import.meta.dir, "commands");
    const calls: string[] = [];

    for (const entry of readdirSync(commandDir)) {
      const contents = readFileSync(join(commandDir, entry), "utf8");

      for (const match of contents.matchAll(/context\.runner\.(\w+)\(/g)) {
        const method = match[1];
        if (method !== undefined) calls.push(method);
      }

      // Nothing may reach for an engine service or a store.
      for (const forbidden of [
        "ExecutionService",
        "ExecutionEngine",
        "Repository",
        "ArtifactStore",
        "ApprovalManager",
        "openDatabase",
        "FileStore",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }

    // Public WorkflowRunner methods only.
    const allowed = new Set([
      "start",
      "status",
      "progress",
      "explain",
      "history",
      "pendingApproval",
      "approve",
      "reject",
    ]);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(allowed.has(call)).toBe(true);
  });

  test("the worker catalogue holds no execution logic", () => {
    const runner = readFileSync(
      join(import.meta.dir, "services", "cli-runner.ts"),
      "utf8",
    );

    // Resolution is a lookup: worker → workflow id. The runner still executes.
    expect(runner).toContain("primaryWorkflowOf");
    expect(runner).toContain("createWorkerRegistry");
  });
});
