// apps/designflow-cli/src/cli.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch, CLI_VERSION } from "./cli";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import { ScriptedTerminal } from "./ui/terminal";
import { explainError } from "./ui/errors";
import { DesignFlowError } from "@designflow/sdk";
import { AGENT_ERROR_CODES } from "@designflow/agents";
import { TOOL_ERROR_CODES } from "@designflow/tools";
import { MODEL_ERROR_CODES } from "@designflow/models";
import { MCP_ERROR_CODES } from "@designflow/mcp";
import { FIGMA_MCP_ERROR_CODES } from "@designflow/capability-figma-mcp";
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

/**
 * A context against a throwaway home.
 *
 * `DESIGNFLOW_HOME` is set for every context, not just the ones asserting on
 * configuration: `createCliContext` prepares the application directory, so
 * without this the suite would create and mutate the developer's real
 * `~/.designflow` — and the first-run tests would then depend on whether
 * anybody had ever run the CLI on this machine.
 */
function context(options?: { readonly requireApproval?: boolean }): CliContext {
  const home = workspace();
  process.env.DESIGNFLOW_HOME = home;

  const created = createCliContext({
    databasePath: join(home, "runs.json"),
    ...options,
  });
  contexts.push(created);
  return created;
}

/**
 * Answers for the QA Reviewer form.
 *
 * QA Reviewer is this suite's generic worker: it completes deterministically
 * with no network, no model and no external connection, so the tests about
 * runs, history, traces and artifacts can drive a real end-to-end execution.
 * Design Engineer is no longer usable that way — it requires a connected
 * Figma source, which none of these tests configure — so it appears here only
 * in the tests that are *about* that requirement.
 */
const RUN_ANSWERS = [
  "src/components/Header.tsx",
  "accessibility",
  "major",
];

/** The form questions `RUN_ANSWERS` answers, in order. */
const RUN_QUESTIONS = [
  "Review target (src/components/Header.tsx)",
  "Review scope (correctness, accessibility)",
  "Severity threshold (major)",
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
  test("bare invocation enters the product shell", async () => {
    const terminal = new ScriptedTerminal(["q"]);

    const code = await dispatch([], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("DesignFlow");
    expect(terminal.transcript).toContain(
      `Project\n  designflow-monorepo\n  ${process.cwd()}`,
    );
    expect(terminal.transcript).toContain("Design\n  Not selected yet");
    expect(terminal.transcript).toContain("Status\n  Ready");
    expect(terminal.transcript).toContain("Enter  Start Design Engineer");
  });

  test("exits cleanly", async () => {
    const terminal = new ScriptedTerminal(["q"]);

    expect(await dispatch([], context(), terminal)).toBe(0);
    expect(terminal.transcript).toContain("Goodbye.");
  });

  test("help returns to the persistent shell", async () => {
    const terminal = new ScriptedTerminal(["?", "q"]);

    await dispatch([], context(), terminal);

    expect(terminal.transcript).toContain("DesignFlow help");
    expect(terminal.output.filter((line) => line === "DesignFlow")).toHaveLength(1);
  });

  test("starting Design Engineer uses the existing run path", async () => {
    const terminal = new ScriptedTerminal([
      "",
      "2",
      "https://www.figma.com/design/abc123/Expenses?node-id=10-1",
      "",
      "q",
    ]);

    expect(await dispatch([], context(), terminal)).toBe(0);
    expect(terminal.transcript).toContain("Starting Design Engineer...");
    expect(terminal.transcript).toContain("Figma");
    expect(terminal.transcript).toContain("Not connected");
    expect(terminal.transcript).toContain("Where should this design go?");
    expect(terminal.transcript).toContain("This worker reads a connected Figma design.");
    expect(terminal.transcript).toContain("Nothing was run and no files were changed.");
  });

  test("explicit commands still route normally", async () => {
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["--version"], context(), terminal)).toBe(0);
    expect(terminal.transcript).toContain("DesignFlow");
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
      "Turns a connected Figma design into an engineering specification or reviewed code changes you approve before anything is written",
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

describe("designflow workers", () => {
  test("workers is the same command as list", async () => {
    const terminal = new ScriptedTerminal();

    await dispatch(["workers"], context(), terminal);

    expect(terminal.transcript).toContain("Available AI Workers");
    expect(terminal.transcript).toContain("QA Reviewer");
    expect(terminal.transcript).toContain("Research Analyst");
    expect(terminal.transcript).toContain("Product Manager");
  });

  test("workers <id> shows one worker's detail with no internal ids", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["workers", "qa-reviewer"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("QA Reviewer");
    expect(terminal.transcript).toContain("quality");
    expect(terminal.transcript).toContain("designflow run qa-reviewer");
    expect(terminal.transcript).not.toContain("qa-reviewer-agent");
    expect(terminal.transcript).not.toContain("qa-review\n");
    // A provider id is internal vocabulary too; the detail view showed it raw.
    expect(terminal.transcript).not.toContain("openrouter");
  });

  test("workers <id> reports an unknown worker without a stack trace", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["workers", "nobody"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No such worker: nobody");
  });
});

// ── 3. `designflow run` starts a workflow ───────────────────────

describe("designflow run", () => {
  test("runs a workflow to completion through the product layer", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    const code = await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Complete");
    expect(terminal.transcript).toContain("Created  5");
    expect(terminal.transcript).toContain(
      "Output stored as DesignFlow artifacts — no files were written to your project.",
    );
    expect(terminal.transcript).toContain("Inspect the result: designflow artifacts");
  });

  test("asks for each declared input field", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.questions).toEqual(RUN_QUESTIONS);
  });

  test("shows the checklist as steps land", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("✓ Collect review target");
    expect(terminal.transcript).toContain("✓ Produce qa report");
    expect(terminal.transcript).toContain("5 of 5 steps");
  });

  test("lists what the run produced", async () => {
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("Issue list");
    expect(terminal.transcript).toContain("from Review target summary");
  });

  test("asks for approval when the workflow is gated", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS, "approve"]);

    const code = await dispatch(["run", "qa-reviewer"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Approval required");
    expect(terminal.transcript).toContain("Store the generated result as a DesignFlow artifact");
    expect(terminal.transcript).toContain(
      "Output stored as DesignFlow artifacts — no files were written to your project.",
    );
  });

  test("rejecting stops the run and reports a failure exit code", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS, "reject"]);

    const code = await dispatch(["run", "qa-reviewer"], context(), terminal);

    expect(code).toBe(1);
    // Rejecting says all three things a person needs: that they rejected it,
    // that nothing reached their project, and that the work done before the
    // gate is still inspectable.
    expect(terminal.transcript).toContain("You rejected the proposed changes.");
    expect(terminal.transcript).toContain("Nothing was written to your project.");
  });

  test("blank answers are left absent rather than filled with placeholders", async () => {
    const created = context({ requireApproval: false });
    const terminal = new ScriptedTerminal(["", "", ""]);

    const code = await dispatch(["run", "qa-reviewer"], created, terminal);

    // Pressing through the form used to silently substitute each field's
    // placeholder, so a run happened on input nobody had actually given. An
    // empty answer now leaves the field absent, and a request describing no
    // work is asked about rather than invented.
    expect(code).toBe(1);
    expect(terminal.transcript).toContain("needs more information");
    expect(terminal.transcript).not.toContain("src/components/Header.tsx");
    expect(await created.runner.history()).toHaveLength(0);
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
      ["run", "qa-reviewer"],
      created,
      new ScriptedTerminal(RUN_ANSWERS),
    );

    const terminal = new ScriptedTerminal();
    await dispatch(["history"], created, terminal);

    expect(terminal.transcript).toContain("QA Review");
    expect(terminal.transcript).toContain("completed");
    expect(terminal.transcript).toContain("finished — created 5 artifacts");
  });

  test("survives the process that produced it", async () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    const databasePath = join(home, "runs.json");

    // First "invocation".
    const first = createCliContext({ databasePath, requireApproval: false });
    await dispatch(
      ["run", "qa-reviewer"],
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
    expect(terminal.transcript).toContain("QA Review");
    expect(terminal.transcript).not.toContain("Nothing has run yet.");
  });

  test("can be narrowed to one workflow", async () => {
    const created = context({ requireApproval: false });
    await dispatch(
      ["run", "qa-reviewer"],
      created,
      new ScriptedTerminal(RUN_ANSWERS),
    );

    const terminal = new ScriptedTerminal();
    await dispatch(["history", "qa-review"], created, terminal);

    expect(terminal.transcript).toContain("QA Review");
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

  test("only the composition root constructs the agent layer", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("services/cli-runner.ts")) continue;
      if (readFileSync(path, "utf8").includes("@designflow/agents")) {
        offenders.push(path.split("/").slice(-2).join("/"));
      }
    }

    // Agents are wired in one place, like the engine. Everything else asks the
    // product boundary what should happen.
    expect(offenders).toEqual([]);
  });

  test("only the composition root constructs FileSessionStore or AgentSessionService", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("services/cli-runner.ts")) continue;
      const contents = readFileSync(path, "utf8");

      for (const forbidden of ["FileSessionStore", "new AgentSessionService"]) {
        if (contents.includes(forbidden)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${forbidden}`);
        }
      }
    }

    // Every command reaches sessions through `context.sessions` — the same
    // `AgentSessionService` instance the composition root built, never a
    // second one and never the concrete file store underneath it.
    expect(offenders).toEqual([]);
  });

  test("only the composition root constructs the project/memory stores or their services", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("services/cli-runner.ts")) continue;
      const contents = readFileSync(path, "utf8");

      for (const forbidden of [
        "@designflow/storage-file",
        "FileProjectStore",
        "FileProjectContextStore",
        "FileAgentMemoryStore",
        "FileMemoryProposalStore",
        "new ProjectService",
        "new ProjectContextService",
        "new AgentMemoryService",
        "new MemoryProposalService",
        "new ContextAssemblyService",
      ]) {
        if (contents.includes(forbidden)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${forbidden}`);
        }
      }
    }

    // Every command reaches projects/memory through `context.projects` /
    // `context.memory` / `context.memoryProposals` — the same instances the
    // composition root built, never a second one and never a concrete store.
    expect(offenders).toEqual([]);
  });

  test("only the composition root constructs the tool layer", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("services/cli-runner.ts")) continue;
      if (readFileSync(path, "utf8").includes("@designflow/tools")) {
        offenders.push(path.split("/").slice(-2).join("/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * A source file with its comments removed.
   *
   * The prose in these files names the things they must not touch — explaining
   * that a command holds no `TraceStore` requires writing `TraceStore`.
   * Scanning code keeps the rule about what a file *does* rather than about
   * what it is allowed to discuss.
   */
  function codeOf(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  test("no command reaches a trace store", () => {
    const commandDir = join(import.meta.dir, "commands");

    for (const entry of readdirSync(commandDir)) {
      const contents = codeOf(join(commandDir, entry));

      // Commands read `context.traces`, the product service. A command holding
      // a store could write the record it displays, and a record its own
      // reader can edit is not an audit record.
      for (const forbidden of [
        "TraceStore",
        "FileTraceStore",
        "InMemoryTraceStore",
        "TraceCollector",
        "@designflow/storage-file",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("no command reaches the tool layer or knows a tool id", () => {
    const commandDir = join(import.meta.dir, "commands");

    for (const entry of readdirSync(commandDir)) {
      const contents = readFileSync(join(commandDir, entry), "utf8");

      // The CLI asks what should happen. Which tools exist, which are
      // permitted and what they are called is none of its business.
      for (const forbidden of [
        "@designflow/tools",
        "ToolRegistry",
        "ToolRuntime",
        "allowedTools",
        "toolId",
        "classify-design-task",
        "project-summary",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("the composition root wires tools but never calls one", () => {
    const runner = readFileSync(
      join(import.meta.dir, "services", "cli-runner.ts"),
      "utf8",
    );

    expect(runner).toContain("ToolRuntime");
    expect(runner).toContain("createToolRegistry");
    // Wiring is the composition root's job. Invoking is the agent's, through
    // a service port it cannot widen.
    expect(runner).not.toContain(".invoke(");
    expect(runner).not.toContain(".call(");
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
    expect(terminal.transcript).toContain("designflow workers");
    expect(terminal.transcript).toContain("designflow run <worker>");
    expect(terminal.transcript).toContain("designflow history");
    expect(terminal.transcript).toContain("designflow settings");
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
    expect(terminal.transcript).toContain(`DesignFlow ${CLI_VERSION}`);
  });

  test("rejects an unknown command with usage", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["frobnicate"], context(), terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("Unknown command: frobnicate");
    expect(terminal.transcript).toContain("Usage:");
  });

  test("no arguments means interactive mode", async () => {
    const terminal = new ScriptedTerminal(["q"]);

    await dispatch([], context(), terminal);

    expect(terminal.transcript).toContain("DesignFlow");
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
  test("a worker resolves to its canonical workflow even when its prerequisite is absent", () => {
    const resolved = context().resolve("design-engineer");

    expect(resolved?.worker.id).toBe("design-engineer");
    expect(resolved?.workflowId).toBe("design-to-code-figma-specification");
    expect(resolved?.workflowInstalled).toBe(false);
    expect(resolved?.steps).toBe(0);
  });

  test("an unknown name resolves to nothing", () => {
    expect(context().resolve("nobody")).toBeNull();
  });

  test("the compatibility workflow stays unavailable through public resolution", () => {
    // Historical artifacts and internal harnesses retain the workflow, but a
    // person cannot bypass coordinator routing with its legacy form.
    expect(context().resolve("design-to-code")).toBeNull();
  });

  test("running by workflow id teaches the worker's name", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "qa-review"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain(
      "(qa-review is a workflow — its worker is qa-reviewer)",
    );
  });

  test("running by worker name says nothing about workflows", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("QA Reviewer");
    expect(terminal.transcript).not.toContain("is a workflow");
  });

  test("the catalogue is reachable from the CLI context", () => {
    const workers = context().workers.listWorkers();

    expect(workers.map((worker) => worker.id)).toEqual([
      "design-engineer",
      "qa-reviewer",
      "research-analyst",
      "product-manager",
    ]);
  });
});

// ── Running a worker executes the right workflow ─────────────────

describe("running a worker", () => {
  test("executes the workflow the worker names", async () => {
    const created = context({ requireApproval: false });
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(["run", "qa-reviewer"], created, terminal);

    // The run is recorded against the workflow, not the worker: workers are a
    // naming layer, and the engine never learns they exist.
    const history = await created.runner.history();

    expect(history).toHaveLength(1);
    expect(history[0]?.workflowId).toBe("qa-review");
    expect(history[0]?.state).toBe("ready");
  });

  test("asks for the fields the worker's manifest declares", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    // The questions come from the manifest, so adding a worker adds no code to
    // the run command.
    expect(terminal.questions).toEqual(RUN_QUESTIONS);
  });

  test("produces the workflow's artifacts", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    expect(terminal.transcript).toContain("Review target summary");
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

// ── Agent-backed workers ────────────────────────────────────────

describe("running through an agent", () => {
  test("the shipped Design Engineer delegates to an agent", () => {
    const worker = context().workers.getWorker("design-engineer");

    expect(worker?.agentId).toBe("design-engineer-coordinator");
  });

  test("the agent resolves the request to the workflow that handles it", async () => {
    const created = context();

    const { decision } = await created.routeTask({
      workerId: "qa-reviewer",
      request: "reviewTarget: src/components/Header.tsx",
      input: { reviewTarget: "src/components/Header.tsx" },
    });

    expect(decision).toMatchObject({
      type: "run_workflow",
      workflowId: "qa-review",
    });
  });

  test("designflow run executes what the agent chose", async () => {
    const created = context({ requireApproval: false });
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    const code = await dispatch(["run", "qa-reviewer"], created, terminal);

    // Worker → product boundary → AgentRuntime → WorkflowRunner → qa-review.
    // The user experience is unchanged; the path underneath is not.
    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Complete");

    const history = await created.runner.history();
    expect(history[0]?.workflowId).toBe("qa-review");
  });

  test("the run says nothing about agents", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    // A person hires a QA Reviewer. That an agent picked the workflow is
    // machinery they should not have to learn, exactly as workflow ids are.
    expect(terminal.transcript).not.toContain("agent");
    expect(terminal.transcript).not.toContain("Agent");
  });

  test("a workflow id still routes, through the worker that owns it", async () => {
    const created = context();

    const { worker, decision } = await created.routeTask({
      workerId: "qa-review",
      request: "review src/components/Header.tsx",
    });

    expect(worker.id).toBe("qa-reviewer");
    expect(decision).toMatchObject({ workflowId: "qa-review" });
  });

  test("a legacy worker with no agent still resolves directly", async () => {
    const created = context();

    created.workers.registerWorker({
      id: "legacy-worker",
      name: "Legacy",
      description: "Written before agents existed",
      category: "testing",
      workflows: ["design-to-code"],
      inputs: [],
    });

    const { decision } = await created.routeTask({
      workerId: "legacy-worker",
      request: "",
    });

    // No agentId, so no agent is consulted and the mapping is what it always was.
    expect(decision).toEqual({
      type: "run_workflow",
      workflowId: "design-to-code",
    });
  });

  test("an empty request produces a clarification, and nothing runs", async () => {
    const created = context();

    const { decision } = await created.routeTask({
      workerId: "design-engineer",
      request: "",
      input: {},
    });

    expect(decision.type).toBe("request_clarification");
    expect(await created.runner.history()).toHaveLength(0);
  });

  test("the CLI shows a clarification and stops safely when nothing is answered", async () => {
    const created = context();
    // No scripted answers at all: the very first "Answer" prompt for the
    // clarification returns empty, exercising the "nothing was lost" safe
    // path rather than depending on how many turns a loop takes to give up.
    const terminal = new ScriptedTerminal([]);

    // A worker whose form collects nothing, so the request describes no work.
    created.workers.registerWorker({
      id: "silent-worker",
      name: "Silent Worker",
      description: "Collects no input",
      category: "testing",
      workflows: ["design-to-code"],
      inputs: [],
      agentId: "design-engineer-agent",
    });

    const code = await dispatch(["run", "silent-worker"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("needs more information");
    expect(terminal.transcript).toContain("I work from a connected Figma design.");
    expect(terminal.transcript).toContain("Session saved.");

    // Stopped safely with no answer given, no execution recorded.
    expect(await created.runner.history()).toHaveLength(0);
  });

  test("answering a clarification with a real answer resolves it rather than asking again", async () => {
    const created = context({ requireApproval: false });
    // Nothing typed into the form (`silent-worker-2` collects none) — but the
    // clarification's own answer is real, on-topic text. Before the fix for
    // an adversarial-verification finding, this asked the identical question
    // a second time no matter what was answered here, forever. It now
    // resolves and the answer is carried all the way into a finished run.
    const terminal = new ScriptedTerminal([
      "Review src/components/Header.tsx for accessibility",
    ]);

    created.workers.registerWorker({
      id: "silent-worker-2",
      name: "Silent Worker Two",
      description: "Collects no input",
      category: "testing",
      workflows: ["qa-review"],
      inputs: [],
      agentId: "qa-reviewer-agent",
    });

    const code = await dispatch(["run", "silent-worker-2"], created, terminal);

    // Asked exactly once — the regression this guards against asked it
    // (and every scripted answer) again, then gave up with "Session saved."
    expect(terminal.transcript.match(/needs more information/g)).toHaveLength(1);
    expect(terminal.transcript).not.toContain("Session saved.");
    // Progressed into real execution rather than staying `waiting_for_user`.
    expect(terminal.transcript).toContain("Collect review target");
    expect(code).toBe(0);
  });
});

// ── Tool-backed decisions ───────────────────────────────────────

describe("running through a tool-backed agent", () => {
  test("designflow run design-engineer stops on setup guidance when Figma is not connected", async () => {
    const created = context({ requireApproval: false });
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    const code = await dispatch(["run", "design-engineer"], created, terminal);

    // The Design Engineer works from a connected Figma design. With none
    // configured there is nothing honest to run, so the command explains the
    // setup instead of falling back to the legacy scaffold — and it does so
    // before collecting a single answer.
    expect(code).toBe(1);
    expect(terminal.questions).toEqual([]);
    // The shared readiness wording, identical to what doctor prints.
    expect(terminal.transcript).toContain("This worker reads a connected Figma design.");
    expect(terminal.transcript).toContain("No Figma connection is configured.");
    expect(terminal.transcript).toContain("Nothing was run and no files were changed.");

    // Nothing was started: no execution, and no session left waiting.
    expect(await created.runner.history()).toHaveLength(0);
    expect(await created.sessions.listSessions()).toHaveLength(0);
  });

  test("the setup guidance names a command, not an internal switch", async () => {
    const terminal = new ScriptedTerminal();

    await dispatch(["run", "design-engineer"], context(), terminal);

    // Guidance a person can act on: a command they can run. Which flag or
    // workflow id makes it work is machinery, exactly as elsewhere.
    expect(terminal.transcript).toContain("designflow doctor");
    for (const leak of [
      "settings.experimental",
      "experimental",
      "design-to-code",
      "design-to-code-implementation",
    ]) {
      expect(terminal.transcript).not.toContain(leak);
    }
  });

  test("the classifier's answer changes what happens", async () => {
    const created = context();

    // A request describing recognisable review work runs.
    const reviewed = await created.routeTask({
      workerId: "qa-reviewer",
      request: "review the header component",
      input: { reviewTarget: "src/components/Header.tsx" },
    });

    // Design Engineer asks instead — it has no connected Figma design to work
    // from, so it clarifies rather than reaching for the legacy scaffold.
    const asked = await created.routeTask({
      workerId: "design-engineer",
      request: "build a login page",
      input: { designFile: "homepage.fig" },
    });

    expect(reviewed.decision.type).toBe("run_workflow");
    expect(asked.decision.type).toBe("request_clarification");
    expect(asked.decision).toMatchObject({
      question: expect.stringContaining("Figma") as unknown as string,
    });
    expect(await created.runner.history()).toHaveLength(0);
  });

  test("an unrecognisable request stops safely at the CLI", async () => {
    const created = context();

    created.workers.registerWorker({
      id: "vague-worker",
      name: "Vague Worker",
      description: "Collects a field that describes nothing",
      category: "testing",
      workflows: ["design-to-code"],
      inputs: [{ key: "note", label: "Note", placeholder: "asdf" }],
      agentId: "design-engineer-agent",
    });

    const terminal = new ScriptedTerminal(["asdf"]);
    const code = await dispatch(["run", "vague-worker"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("needs more information");
    expect(terminal.transcript).toContain("I work from a connected Figma design.");
    expect(await created.runner.history()).toHaveLength(0);
  });

  test("the run says nothing about tools", async () => {
    const terminal = new ScriptedTerminal([...RUN_ANSWERS]);

    await dispatch(
      ["run", "qa-reviewer"],
      context({ requireApproval: false }),
      terminal,
    );

    // A person hires a QA Reviewer. That it consulted a classifier is
    // machinery, exactly as agents and workflow ids are.
    for (const leak of ["tool", "Tool", "classify", "agent", "Agent", "qa-review\n"]) {
      expect(terminal.transcript).not.toContain(leak);
    }
  });

  test("a legacy worker with no agent runs with no tools at all", async () => {
    const created = context();

    created.workers.registerWorker({
      id: "legacy-worker",
      name: "Legacy",
      description: "Written before agents or tools existed",
      category: "testing",
      workflows: ["design-to-code"],
      inputs: [],
    });

    const { decision } = await created.routeTask({
      workerId: "legacy-worker",
      request: "",
    });

    // No agent, so no classifier, so no clarification — the Stage 33 mapping,
    // untouched two stages later.
    expect(decision).toEqual({
      type: "run_workflow",
      workflowId: "design-to-code",
    });
  });
});

// ── Traces ──────────────────────────────────────────────────────

describe("designflow traces", () => {
  test("says so when no decision has been made", async () => {
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["traces"], context(), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("No AI decisions have been made yet.");
  });

  test("shows a completed run's decision in the user's vocabulary", async () => {
    const created = context({ requireApproval: false });
    await dispatch(["run", "qa-reviewer"], created, new ScriptedTerminal(RUN_ANSWERS));

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["traces"], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("AI decisions");
    expect(terminal.transcript).toContain("QA Reviewer");
    expect(terminal.transcript).toContain("started the work");
    expect(terminal.transcript).toContain("Tools consulted: 1");
  });

  // ── 9. Correlation with the execution ─────────────────────────

  test("the trace names the run it produced", async () => {
    const created = context({ requireApproval: false });
    await dispatch(["run", "qa-reviewer"], created, new ScriptedTerminal(RUN_ANSWERS));

    const [trace] = await created.traces.listTraces();
    const [run] = await created.runner.history();

    expect(trace?.executionId).toBe(run?.executionId);
    expect(trace?.workflowId).toBe("qa-review");

    // And the bridge works in the other direction.
    const found = await created.traces.getExecutionTrace(run?.executionId ?? "");
    expect(found?.id).toBe(trace?.id);
  });

  test("a clarification is traced, with no run attached", async () => {
    const created = context();

    created.workers.registerWorker({
      id: "vague-worker",
      name: "Vague Worker",
      description: "collects a field that describes nothing",
      category: "testing",
      workflows: ["design-to-code"],
      inputs: [{ key: "note", label: "Note", placeholder: "asdf" }],
      agentId: "design-engineer-agent",
    });

    await dispatch(["run", "vague-worker"], created, new ScriptedTerminal(["asdf"]));

    const [trace] = await created.traces.listTraces();

    // The case engine history cannot answer: a decision that produced no run.
    expect(trace?.decisionType).toBe("request_clarification");
    expect(trace?.executionId).toBeUndefined();
    expect(await created.runner.history()).toHaveLength(0);

    const terminal = new ScriptedTerminal();
    await dispatch(["traces"], created, terminal);
    expect(terminal.transcript).toContain("asked for more detail");
  });

  test("a single trace can be looked up by id", async () => {
    const created = context({ requireApproval: false });
    await dispatch(["run", "qa-reviewer"], created, new ScriptedTerminal(RUN_ANSWERS));

    const [trace] = await created.traces.listTraces();
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["traces", trace?.id ?? ""], created, terminal)).toBe(0);
    expect(terminal.transcript).toContain("QA Reviewer");
  });

  test("an unknown id is reported without a stack trace", async () => {
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["traces", "nope"], context(), terminal)).toBe(1);
    expect(terminal.transcript).toContain("No trace with that id");
    expect(terminal.transcript).not.toContain("    at ");
  });

  // ── 11-14. What the display never shows ───────────────────────

  test("shows no reasoning, prompt, tool payload or internal id", async () => {
    const created = context({ requireApproval: false });
    await dispatch(["run", "qa-reviewer"], created, new ScriptedTerminal(RUN_ANSWERS));

    const terminal = new ScriptedTerminal();
    await dispatch(["traces"], created, terminal);

    for (const leak of [
      "qa-review\n",
      "qa-reviewer-agent",
      "classify-design-task",
      "taskType",
      "confidence",
      "src/components/Header.tsx",
      "reasoning",
      "chainOfThought",
    ]) {
      expect(terminal.transcript).not.toContain(leak);
    }
  });

  test("traces survive the process that produced them", async () => {
    const home = workspace();
    process.env.DESIGNFLOW_HOME = home;
    const databasePath = join(home, "runs.json");

    const first = createCliContext({ databasePath, requireApproval: false });
    await dispatch(["run", "qa-reviewer"], first, new ScriptedTerminal(RUN_ANSWERS));
    first.close();

    // A second "invocation" sharing nothing but the file.
    const second = createCliContext({ databasePath, requireApproval: false });
    contexts.push(second);

    const terminal = new ScriptedTerminal();
    await dispatch(["traces"], second, terminal);

    expect(terminal.transcript).toContain("started the work");
    expect((await second.traces.listTraces())[0]?.executionId).toBeDefined();
  });

  test("a failing trace write cannot break a run that already happened", async () => {
    // By the time correlation is attempted the workflow has started and
    // artifacts may exist. A full disk must not turn a run that worked into an
    // error the user cannot act on — this was a real defect, found by breaking
    // the store and watching a completed run report failure.
    const created = context({ requireApproval: false });

    (created.traces as { correlate: unknown }).correlate = () =>
      Promise.reject(new Error("disk full"));

    const terminal = new ScriptedTerminal(RUN_ANSWERS);
    const code = await dispatch(["run", "qa-reviewer"], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Complete");
    expect(await created.runner.history()).toHaveLength(1);
  });

  test("a failing trace store does not break the decision either", async () => {
    const created = context({ requireApproval: false });

    // The runtime's own trace writes are already guarded; this asserts the
    // guard end to end rather than only in the agents package.
    (created.traces as { correlate: unknown }).correlate = () => {
      throw new Error("disk full");
    };

    expect(
      await dispatch(["run", "qa-reviewer"], created, new ScriptedTerminal(RUN_ANSWERS)),
    ).toBe(0);
  });

  test("tracing does not change what a run does", async () => {
    // The same assertions the run tests make, re-checked with tracing wired.
    const created = context({ requireApproval: false });
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    expect(await dispatch(["run", "qa-reviewer"], created, terminal)).toBe(0);
    expect(terminal.transcript).toContain("Created  5");
    expect((await created.runner.history())[0]?.state).toBe("ready");
  });
});

// ── Agent failures stay in the user's vocabulary ────────────────

describe("explaining an agent failure", () => {
  /**
   * Every code the agent layer can raise, with the raw message it carries.
   *
   * Built as plain `DesignFlowError`s rather than imported from
   * `@designflow/agents`, so this asserts the CLI's mapping table and nothing
   * else. The messages mirror the real ones because what is being tested is
   * that they never reach a person.
   */
  const AGENT_FAILURES: readonly (readonly [string, string])[] = [
    ["ERR_AGENT_NOT_FOUND", "No such agent: ghost-agent"],
    ["ERR_AGENT_ALREADY_REGISTERED", "An agent is already registered as: x"],
    ["ERR_AGENT_TASK_INVALID", "Invalid agent task: workerId required"],
    [
      "ERR_AGENT_DECISION_INVALID",
      "Agent design-engineer-agent returned an invalid decision: Unrecognized key(s) in object: 'chainOfThought'",
    ],
    [
      "ERR_AGENT_WORKFLOW_NOT_ALLOWED",
      "Agent design-engineer-agent may not run workflow: some-other-workflow",
    ],
    [
      "ERR_AGENT_WORKFLOW_UNAVAILABLE",
      "Workflow design-to-code is not installed, so agent x cannot run it",
    ],
    [
      "ERR_AGENT_RUNTIME_UNAVAILABLE",
      "Worker design-engineer delegates to agent design-engineer-agent, but no agent runtime is configured",
    ],
  ];

  test("every agent code is mapped rather than falling through", () => {
    for (const [code, message] of AGENT_FAILURES) {
      const explained = explainError(new DesignFlowError(code, message));

      // The fallback suggestion is what an unmapped code produces.
      expect(explained.suggestion).not.toContain("designflow --help");
      expect(explained.problem).not.toBe(message);
    }
  });

  test("every code the agent and tool layers publish is mapped", () => {
    // Driven from the packages' own enumerations rather than a list copied
    // here, so a code added upstream fails this test instead of reaching a
    // person as raw internal text. That is not hypothetical — it is exactly
    // what happened when the agent layer was introduced in Stage 35.
    const published = [...AGENT_ERROR_CODES, ...TOOL_ERROR_CODES, ...MODEL_ERROR_CODES, ...MCP_ERROR_CODES, ...FIGMA_MCP_ERROR_CODES];

    expect(published.length).toBeGreaterThan(10);

    const unmapped = published.filter((code) => {
      const explained = explainError(new DesignFlowError(code, "raw internal text"));
      return explained.suggestion.includes("designflow --help");
    });

    expect(unmapped).toEqual([]);
  });

  test("schema rejection is not described as temporary model unavailability", () => {
    const explained = explainError(
      new DesignFlowError("ERR_MODEL_SCHEMA_UNSUPPORTED", "provider detail must stay private"),
    );

    expect(explained.problem).toBe(
      "The configured model rejected the required structured-output schema.",
    );
    expect(explained.problem).not.toContain("temporarily unavailable");
    expect(explained.problem).not.toContain("provider detail");
    expect(explained.suggestion).not.toContain("provider detail");
  });

  test("every published code says whether anything started", () => {
    // The first question a person has after a failure. Six codes described the
    // problem without ever answering it, which this now prevents.
    const silent = [...AGENT_ERROR_CODES, ...TOOL_ERROR_CODES, ...MODEL_ERROR_CODES, ...MCP_ERROR_CODES, ...FIGMA_MCP_ERROR_CODES].filter((code) => {
      const { problem, suggestion } = explainError(
        new DesignFlowError(code, "raw internal text"),
      );
      return !/nothing was started|nothing was written/i.test(`${problem} ${suggestion}`);
    });

    expect(silent).toEqual([]);
  });

  test("every published code offers a next step", () => {
    for (const code of [...AGENT_ERROR_CODES, ...TOOL_ERROR_CODES, ...MODEL_ERROR_CODES, ...MCP_ERROR_CODES, ...FIGMA_MCP_ERROR_CODES]) {
      const { suggestion } = explainError(new DesignFlowError(code, "raw"));

      expect(suggestion).toMatch(
        /designflow list|designflow history|try again|start it again|report (it|this)|check /i,
      );
    }
  });

  test("no published code exposes a stack trace, even from a raw message", () => {
    const raw =
      "Agent x failed\n    at /Users/someone/secret/path.ts:1:1\n    at run (/opt/app/index.js:9:9)";

    for (const code of [...AGENT_ERROR_CODES, ...TOOL_ERROR_CODES, ...MODEL_ERROR_CODES, ...MCP_ERROR_CODES, ...FIGMA_MCP_ERROR_CODES]) {
      const { problem, suggestion } = explainError(new DesignFlowError(code, raw));
      const shown = `${problem} ${suggestion}`;

      expect(shown).not.toContain("    at ");
      expect(shown).not.toContain("/Users/");
      expect(shown).not.toContain("/opt/app");
    }
  });

  test("no published code leaks internal vocabulary to a person", () => {
    for (const code of [...AGENT_ERROR_CODES, ...TOOL_ERROR_CODES, ...MODEL_ERROR_CODES, ...MCP_ERROR_CODES, ...FIGMA_MCP_ERROR_CODES]) {
      const { problem, suggestion } = explainError(
        new DesignFlowError(code, "Agent x may not call tool classify-design-task"),
      );
      const shown = `${problem} ${suggestion}`.toLowerCase();

      for (const leak of ["agent", "tool ", "workflow id", "classify-design-task", "design-to-code"]) {
        expect(shown).not.toContain(leak);
      }
    }
  });

  test("no agent failure exposes agent vocabulary or internal ids", () => {
    for (const [code, message] of AGENT_FAILURES) {
      const { problem, suggestion } = explainError(
        new DesignFlowError(code, message),
      );
      const shown = `${problem} ${suggestion}`.toLowerCase();

      // A person hires a worker. That an agent decided anything on its behalf
      // — and which workflow it reached for — is machinery, not an explanation.
      for (const leak of [
        "agent",
        "design-engineer-agent",
        "design-to-code",
        "workflowid",
        "chainofthought",
        "allowedworkflows",
      ]) {
        expect(shown).not.toContain(leak);
      }
    }
  });

  test("each one still says what to do next", () => {
    for (const [code, message] of AGENT_FAILURES) {
      const { problem, suggestion } = explainError(
        new DesignFlowError(code, message),
      );

      expect(problem.length).toBeGreaterThan(0);
      expect(suggestion.length).toBeGreaterThan(0);
    }
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
      "resumeLatest",
      "resumeApproved",
      "resumeConsumedApproval",
      "status",
      "progress",
      "explain",
      "history",
      "pendingApproval",
      "approve",
      "reject",
      "children",
    ]);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(allowed.has(call)).toBe(true);
  });

  test("no command reaches the agent layer", () => {
    const commandDir = join(import.meta.dir, "commands");

    for (const entry of readdirSync(commandDir)) {
      const contents = readFileSync(join(commandDir, entry), "utf8");

      // The CLI asks what should happen; it does not resolve agents, read
      // manifests or implement a decision rule of its own.
      for (const forbidden of [
        "@designflow/agents",
        "AgentRegistry",
        "AgentRuntime",
        "AgentManifest",
        "allowedWorkflows",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("the composition root wires agents but never asks one to decide", () => {
    const runner = readFileSync(
      join(import.meta.dir, "services", "cli-runner.ts"),
      "utf8",
    );

    // Wiring is the composition root's job. Deciding is the router's, and
    // going around it would put agent logic back in the application.
    expect(runner).toContain("AgentRuntime");
    expect(runner).toContain("WorkerTaskRouter");
    expect(runner).not.toContain(".decide(");
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
