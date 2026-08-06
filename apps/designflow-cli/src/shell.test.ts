// apps/designflow-cli/src/shell.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DesignFlowError } from "@designflow/sdk";
import { InMemoryWorkerRegistry } from "@designflow/workers";
import { dispatch } from "./cli";
import { CLI_VERSION } from "./version";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import { ScriptedTerminal } from "./ui/terminal";
import { explainError, formatError } from "./ui/errors";
import { initializeHome } from "./services/home";
import {
  CONFIG_VERSION,
  configPath,
  configSchema,
  loadConfig,
  migrateConfig,
  saveConfig,
  updateConfig,
} from "./services/config";

/**
 * The first-run experience and the application shell.
 *
 * Every test here drives a throwaway `DESIGNFLOW_HOME`, because the thing under
 * test *is* the creation of that directory. A suite that touched the real
 * `~/.designflow` would pass or fail depending on whether the person running it
 * had ever used the CLI.
 */

// ── Harness ─────────────────────────────────────────────────────

const homes: string[] = [];
const contexts: CliContext[] = [];

/** An empty directory that does not yet contain a DesignFlow home. */
function freshHome(): string {
  const parent = mkdtempSync(join(tmpdir(), "designflow-home-"));
  homes.push(parent);

  const home = join(parent, ".designflow");
  process.env.DESIGNFLOW_HOME = home;
  return home;
}

function context(
  home: string,
  options?: { readonly workers?: InMemoryWorkerRegistry },
): CliContext {
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
 * QA Reviewer is the shell's generic worker: it completes deterministically
 * offline, so a menu-driven run can be followed all the way to "Complete".
 * Design Engineer needs a connected Figma design, which no test configures.
 */
const RUN_ANSWERS = ["src/components/Header.tsx", "accessibility", "major"];

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
  delete process.env.DESIGNFLOW_HOME;
  delete process.env.DESIGNFLOW_DEBUG;
});

// ── 1. First run creates ~/.designflow ──────────────────────────

describe("first run", () => {
  test("creates the application directory", () => {
    const home = freshHome();

    expect(existsSync(home)).toBe(false);

    const state = initializeHome();

    expect(state.firstRun).toBe(true);
    expect(existsSync(home)).toBe(true);
  });

  test("creates config.json, history/ and cache/", () => {
    const home = freshHome();

    initializeHome();

    expect(existsSync(join(home, "config.json"))).toBe(true);
    expect(statSync(join(home, "history")).isDirectory()).toBe(true);
    expect(statSync(join(home, "cache")).isDirectory()).toBe(true);
  });

  test("shows onboarding, then continues into the application", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal();

    const code = await dispatch(["list"], context(home), terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Welcome to DesignFlow.");
    expect(terminal.transcript).toContain("Your AI workforce in the terminal.");

    // "After setup, continue into the application" — onboarding is a preamble,
    // not a wall. The command the user typed still ran.
    expect(terminal.transcript).toContain("Available AI Workers");
  });

  test("names what it put on the disk", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal();

    await dispatch(["list"], context(home), terminal);

    // An installed application should not leave someone guessing what it wrote.
    expect(terminal.transcript).toContain(home);
    expect(terminal.transcript).toContain("config.json");
    expect(terminal.transcript).toContain("history/");
    expect(terminal.transcript).toContain("cache/");
  });

  test("does not greet an upgrading user, and keeps their settings", async () => {
    const home = freshHome();
    mkdirSync(home, { recursive: true });

    // A config from a CLI predating `firstRunCompleted` — what an upgrade finds.
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        version: 1,
        environment: "local",
        databasePath: "designflow.json",
        settings: {},
      }),
    );

    const state = initializeHome();

    // Setup still has a flag to write and directories to add...
    expect(state.firstRun).toBe(true);
    // ...but this is not a new installation, and saying so would describe work
    // DesignFlow did not do to a directory the user already had.
    expect(state.newInstall).toBe(false);

    // Their configured database path must survive, or their history moves out
    // from under them.
    expect(state.config.databasePath).toBe("designflow.json");
    expect(loadConfig().firstRunCompleted).toBe(true);

    const terminal = new ScriptedTerminal();
    await dispatch(["list"], context(home), terminal);

    expect(terminal.transcript).not.toContain("Welcome to DesignFlow.");
    expect(terminal.transcript).not.toContain("Set up");
    expect(terminal.transcript).toContain("Available AI Workers");
  });

  test("finishes setup that a previous run left half-done", () => {
    const home = freshHome();

    // A directory and a config, but `firstRunCompleted` never written — what an
    // interrupted first run leaves behind.
    saveConfig(configSchema.parse({ firstRunCompleted: false }));
    rmSync(join(home, "cache"), { recursive: true, force: true });

    const state = initializeHome();

    // Keyed off the config rather than the directory, so this completes instead
    // of silently skipping.
    expect(state.firstRun).toBe(true);
    expect(existsSync(join(home, "cache"))).toBe(true);
  });
});

// ── 2. Config is persisted ──────────────────────────────────────

describe("configuration", () => {
  test("writes the documented shape", () => {
    freshHome();

    initializeHome();

    const written: unknown = JSON.parse(readFileSync(configPath(), "utf8"));

    expect(written).toMatchObject({
      version: CONFIG_VERSION,
      firstRunCompleted: true,
    });
  });

  test("survives a reload", () => {
    freshHome();

    initializeHome();
    updateConfig({ environment: "staging" });

    expect(loadConfig().environment).toBe("staging");
    expect(loadConfig().firstRunCompleted).toBe(true);
  });

  test("defaults every field when there is no file", () => {
    freshHome();

    const config = loadConfig();

    expect(config.version).toBe(CONFIG_VERSION);
    expect(config.firstRunCompleted).toBe(false);
    expect(config.environment).toBe("local");
    expect(config.settings).toEqual({});
  });

  test("reads a config from a newer CLI rather than discarding it", () => {
    const config = migrateConfig({
      version: 99,
      firstRunCompleted: true,
      environment: "local",
      databasePath: "history/runs.json",
      settings: { somethingNew: true },
    });

    // Forward compatibility: an unknown version is a config to read, not a
    // config to overwrite.
    expect(config.version).toBe(99);
    expect(config.settings).toEqual({ somethingNew: true });
  });

  test("salvages the good fields from a partly broken file", () => {
    const config = migrateConfig({
      firstRunCompleted: true,
      environment: 42, // wrong type
      databasePath: "history/mine.json",
    });

    // One bad value must not cost every good one — and above all must not reset
    // `firstRunCompleted`, which would replay onboarding for an existing user.
    expect(config.firstRunCompleted).toBe(true);
    expect(config.databasePath).toBe("history/mine.json");
    expect(config.environment).toBe("local");
  });

  test("falls back to defaults for a file that is not JSON", () => {
    const home = freshHome();
    initializeHome();
    writeFileSync(join(home, "config.json"), "{ not json");

    expect(loadConfig().environment).toBe("local");
  });

  test("writes atomically, leaving no partial file behind", () => {
    freshHome();
    initializeHome();

    saveConfig(configSchema.parse({ environment: "staging" }));

    // The temp file used for the rename must not survive the write.
    expect(existsSync(`${configPath()}.tmp`)).toBe(false);
    expect(loadConfig().environment).toBe("staging");
  });
});

// ── 3. Second run skips onboarding ──────────────────────────────

describe("second run", () => {
  test("reports firstRun false and leaves the config alone", () => {
    freshHome();

    const first = initializeHome();
    updateConfig({ environment: "staging" });

    const second = initializeHome();

    expect(first.firstRun).toBe(true);
    expect(second.firstRun).toBe(false);
    // Setup must not stamp over settings someone has changed.
    expect(second.config.environment).toBe("staging");
  });

  test("says nothing about welcome", async () => {
    const home = freshHome();

    // First invocation, whose onboarding we expect to see.
    const first = new ScriptedTerminal();
    await dispatch(["list"], context(home), first);
    expect(first.transcript).toContain("Welcome to DesignFlow.");

    // Second invocation. A new process would share nothing but the directory.
    const second = new ScriptedTerminal();
    await dispatch(["list"], context(home), second);

    expect(second.transcript).not.toContain("Welcome to DesignFlow.");
    expect(second.transcript).not.toContain("Your AI workforce in the terminal.");
    expect(second.transcript).toContain("Available AI Workers");
  });
});

// ── 4. Main menu appears ────────────────────────────────────────

describe("main menu", () => {
  test("offers the four options in order", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal(["4"]);

    const code = await dispatch([], context(home), terminal);

    expect(code).toBe(0);

    const menu = terminal.transcript;
    expect(menu).toContain("DesignFlow AI");
    expect(menu.indexOf("1. Use an AI Worker")).toBeLessThan(
      menu.indexOf("2. View History"),
    );
    expect(menu.indexOf("2. View History")).toBeLessThan(
      menu.indexOf("3. Settings"),
    );
    expect(menu.indexOf("3. Settings")).toBeLessThan(menu.indexOf("4. Exit"));
  });

  test("option 3 shows where things are kept", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal(["3", "4"]);

    await dispatch([], context(home), terminal);

    expect(terminal.transcript).toContain("Settings");
    expect(terminal.transcript).toContain(home);
    expect(terminal.transcript).toContain(`DesignFlow ${CLI_VERSION}`);
    expect(terminal.transcript).toContain("4 installed");
  });

  test("settings offers no account, key or endpoint", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal();

    await dispatch(["settings"], context(home), terminal);

    // Out of scope by design, and the screen a user would look at for them is
    // the place a promise would accidentally get made.
    for (const forbidden of ["API key", "Sign in", "Account", "Token", "http"]) {
      expect(terminal.transcript).not.toContain(forbidden);
    }
  });

  test("option 2 shows history and returns to the menu", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal(["2", "4"]);

    await dispatch([], context(home), terminal);

    expect(terminal.transcript).toContain("Previous runs");
    expect(terminal.transcript).toContain("Goodbye.");
  });
});

// ── 5. Workers are loaded dynamically ───────────────────────────

describe("the menu reads the worker registry", () => {
  test("lists the installed workers", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal(["1", "2", ...RUN_ANSWERS, "no", "4"]);

    await dispatch([], context(home), terminal);

    expect(terminal.transcript).toContain("Who would you like to use?");
    expect(terminal.transcript).toContain("1. Design Engineer");
    expect(terminal.transcript).toContain("2. QA Reviewer");

    // The picker's answer chooses the worker, and that worker's job runs to
    // completion without leaving the menu.
    expect(terminal.transcript).toContain("Complete");
  });

  test("picking the Design Engineer with no Figma connection explains the setup and returns to the menu", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal(["1", "1", "4"]);

    const code = await dispatch([], context(home), terminal);

    // The interactive path reaches the same prerequisite as `designflow run`:
    // no connected Figma design means setup guidance, not a legacy scaffold.
    // A session is a place to work, so this returns to the menu rather than
    // ending the process.
    expect(code).toBe(0);
    expect(terminal.transcript).toContain(
      "The Design Engineer works from a connected Figma design",
    );
    expect(terminal.transcript).toContain("Nothing was run and no files were changed.");
    expect(terminal.transcript).toContain("Goodbye.");
  });

  test("a worker registered at runtime appears with no code change", async () => {
    const home = freshHome();
    const created = context(home);

    created.workers.registerWorker({
      id: "copy-editor",
      name: "Copy Editor",
      description: "Invented by this test, never named in the CLI",
      category: "writing",
      workflows: ["design-to-code"],
      inputs: [],
    });

    const terminal = new ScriptedTerminal(["1", "9", "4"]);
    await dispatch([], created, terminal);

    // The picker reads the registry every time. Nothing in commands/ or ui/
    // names a worker, so adding one is a registration rather than an edit.
    expect(terminal.transcript).toContain("1. Design Engineer");
    expect(terminal.transcript).toContain("5. Copy Editor");
    expect(terminal.transcript).toContain(
      "Invented by this test, never named in the CLI",
    );
  });

  test("no worker in the catalogue means no worker in the menu", async () => {
    const home = freshHome();

    // An empty catalogue, to prove the menu is driven by the registry rather
    // than by a list in the source.
    const created = context(home, { workers: new InMemoryWorkerRegistry() });

    const terminal = new ScriptedTerminal(["1", "4"]);
    await dispatch([], created, terminal);

    expect(terminal.transcript).toContain("No AI Workers are installed.");
    expect(terminal.transcript).not.toContain("Design Engineer");
  });

  test("no worker id appears in any printable string in the CLI", () => {
    // Scoped to every non-test source file rather than a chosen few: the two
    // that failed when this was first written were `cli.ts` and `history.ts`,
    // neither of which a list of likely suspects had included.
    //
    // Comments are stripped before matching. A worker named in prose is
    // illustrative; one in a string is a claim the registry has to back.
    const offenders: string[] = [];

    const walk = (dir: string): string[] => {
      const found: string[] = [];

      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
          found.push(...walk(path));
          continue;
        }

        if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
          found.push(path);
        }
      }

      return found;
    };

    for (const path of walk(import.meta.dir)) {
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      const relative = path.split("/").slice(-2).join("/");

      // No file may name a worker. Two deliberate exceptions:
      //
      // The composition root may name the workflow package it installs —
      // loading one is precisely its job — so the workflow id is checked
      // everywhere else.
      //
      // `run.ts` may say "Design Engineer" in prose, and only there: the
      // Figma setup guidance is written *about* that worker's prerequisite,
      // and a sentence assembled from `worker.name` would read as though any
      // worker might need Figma. Its *id* is still forbidden, so nothing
      // routes or branches on a name typed into the source.
      const forbidden = relative.endsWith("services/cli-runner.ts")
        ? ["design-engineer", "Design Engineer"]
        : relative.endsWith("commands/run.ts")
          ? ["design-engineer", "design-to-code"]
          : ["design-engineer", "Design Engineer", "design-to-code"];

      for (const name of forbidden) {
        if (code.includes(name)) offenders.push(`${relative} → ${name}`);
      }
    }

    // The registry is the single source. A hardcoded name works until the
    // catalogue changes and then quietly sends someone somewhere that is not
    // installed.
    expect(offenders).toEqual([]);
  });
});

// ── 6. Version command works ────────────────────────────────────

describe("designflow --version", () => {
  test("names the product and the version", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["--version"], context(home), terminal)).toBe(0);
    expect(terminal.transcript).toContain(`DesignFlow ${CLI_VERSION}`);
  });

  test("-v is the same thing", async () => {
    const home = freshHome();
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["-v"], context(home), terminal)).toBe(0);
    expect(terminal.transcript).toContain(`DesignFlow ${CLI_VERSION}`);
  });

  test("reports the version that would be published", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(dirname(import.meta.dir), "package.json"), "utf8"),
    );

    const version =
      typeof manifest === "object" && manifest !== null && "version" in manifest
        ? (manifest as { version: unknown }).version
        : undefined;

    // The constant is duplicated from package.json because the published entry
    // point is a bundle that cannot reliably resolve its own manifest. This is
    // the check that catches a release reporting a different number than it
    // shipped.
    expect(version).toBe(CLI_VERSION);
  });
});

// ── 7. Errors are user-friendly ─────────────────────────────────

describe("error reporting", () => {
  test("explains a domain error and suggests a next step", () => {
    const explained = explainError(
      new DesignFlowError("ERR_WORKER_NOT_FOUND", "worker 'nobody' not found", {
        available: ["design-engineer"],
      }),
    );

    expect(explained.problem).toBe("No AI Worker by that name is installed.");
    expect(explained.suggestion).toContain("designflow list");
  });

  test("explains a filesystem failure in terms a user can act on", () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });

    const explained = explainError(denied);

    expect(explained.problem).toContain("could not read or write");
    expect(explained.suggestion).toContain("DESIGNFLOW_HOME");
  });

  test("still suggests something for an error it has never seen", () => {
    const explained = explainError(new Error("the flux capacitor jammed"));

    expect(explained.problem).toBe("the flux capacitor jammed");
    expect(explained.suggestion).toContain("DESIGNFLOW_DEBUG");
  });

  test("handles a thrown value that is not an Error", () => {
    expect(explainError("just a string").problem).toBe("just a string");
    expect(explainError(undefined).problem).toBe("Something went wrong.");
  });

  test("hides the stack trace by default", () => {
    const error = new Error("boom");

    const output = formatError(error, false);

    expect(output).toContain("boom");
    expect(output).not.toContain("at ");
    expect(output).not.toContain("shell.test");
  });

  test("shows the stack trace under DESIGNFLOW_DEBUG", () => {
    const output = formatError(new Error("boom"), true);

    // "No stack traces by default" must not mean "no way to diagnose this".
    expect(output).toContain("boom");
    expect(output).toContain("shell.test");
  });

  test("no stack trace escapes the real process", async () => {
    // A file where a directory should be, so preparing the home fails with
    // ENOTDIR before any command runs. Scanning the source for `formatError`
    // would only prove the code is present; this proves what a user sees.
    const parent = mkdtempSync(join(tmpdir(), "designflow-broken-"));
    homes.push(parent);
    writeFileSync(join(parent, "afile"), "");

    const run = async (debug: boolean): Promise<string> => {
      const proc = Bun.spawn(["bun", "run", "src/main.ts", "list"], {
        cwd: dirname(import.meta.dir),
        env: {
          ...process.env,
          DESIGNFLOW_HOME: join(parent, "afile", "home"),
          ...(debug ? { DESIGNFLOW_DEBUG: "1" } : {}),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      expect(await proc.exited).toBe(1);
      return out + err;
    };

    const quiet = await run(false);

    expect(quiet).toContain("runs through a file");
    expect(quiet).toContain("Check DESIGNFLOW_HOME");
    expect(quiet).not.toContain("ENOTDIR");
    expect(quiet).not.toContain("    at ");

    // The escape hatch still works, or this would be undiagnosable.
    expect(await run(true)).toContain("    at ");
  }, 30_000);

  test("the process entry point reports through the mapper", () => {
    const main = readFileSync(join(import.meta.dir, "main.ts"), "utf8");

    // The catch-all is the one place a raw trace could still escape.
    expect(main).toContain("formatError(error)");
    expect(main).not.toContain("error.stack");
  });
});

// ── Architecture ────────────────────────────────────────────────

describe("architecture", () => {
  test("the shell reaches no further than the product layer", () => {
    for (const file of [
      "cli.ts",
      "version.ts",
      "commands/settings.ts",
      "commands/interactive.ts",
      "ui/terminal.ts",
      "ui/errors.ts",
      "services/home.ts",
      "services/config.ts",
    ]) {
      const contents = readFileSync(join(import.meta.dir, file), "utf8");

      for (const forbidden of [
        "@designflow/core",
        "@designflow/storage-file",
        "@designflow/storage-sqlite",
        "ExecutionEngine",
        "ExecutionRepository",
        "ArtifactStore",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("first-run setup prints nothing itself", () => {
    const home = readFileSync(join(import.meta.dir, "services", "home.ts"), "utf8");

    // Filesystem work here, rendering in ui/. That split is what makes the
    // first-run path assertable without a terminal.
    expect(home).not.toContain("console.");
    expect(home).not.toContain("process.stdout");
    expect(home).not.toContain("Welcome");
  });
});
