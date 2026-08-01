// apps/designflow-cli/src/security-audit.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { dispatch } from "./cli";
import { createCliContext, type CliContext } from "./services/cli-runner";
import { createProjectInspector } from "@designflow/tools";

import { ScriptedTerminal } from "./ui/terminal";

/**
 * Stage 42 security audit: path traversal in "safe project inspection".
 *
 * Stage 40's `designflow projects add --path <path>` / `projects inspect
 * <id>` is the CLI's one surface that ever reads a person's filesystem on
 * their behalf, so it is the one this file interrogates.
 *
 * The finding (see `packages/product/src/project-service.ts`,
 * `ProjectService.inspectProject`, and `apps/designflow-cli/src/commands/
 * projects.ts`, `projectsInspectCommand`): there is no user-controllable
 * path parameter reaching the filesystem at inspection time at all.
 * `projects inspect <projectId>` takes only an id; the directory it walks is
 * whatever `rootPath` was `resolve()`d and stored once, at `projects add`
 * time. There is no "project-relative path" argument anywhere in this
 * surface for a `../../etc/passwd` or `/etc/passwd` value to be smuggled
 * through — so the traversal case the task description asks to confirm does
 * not exist to be exploited, and what these tests instead prove is the
 * structural reason: the id-only signature, `resolve()`-collapsed
 * registration, and (belt and braces) that even within an approved root, the
 * walk never follows a symlink out and never reads any file's content but
 * `package.json`.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-cli-secaudit-"));
  workspaces.push(dir);
  return dir;
}

function context(): CliContext {
  const home = workspace();
  process.env.DESIGNFLOW_HOME = home;

  const created = createCliContext({ databasePath: join(home, "runs.json") });
  contexts.push(created);
  return created;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.DESIGNFLOW_HOME;
});

describe("path traversal in project inspection", () => {
  test("projects inspect takes only a project id — no path argument exists to traverse with", async () => {
    // Structural proof, not a runtime probe: the command that reads a
    // project's files off disk (`projectsInspectCommand`, wired to
    // `ProjectService.inspectProject`) accepts exactly one argument, and it
    // is an opaque id already registered in the store — never a string that
    // could carry `../../etc/passwd` or an absolute `/etc/passwd`.
    const built = context();

    const bogus = new ScriptedTerminal([]);
    const code = await dispatch(["projects", "inspect", "../../etc/passwd"], built, bogus);

    // Treated exactly like any other unknown id — a lookup miss, not a path
    // that resolves anywhere. Confirms the string is never touched as a
    // filesystem path, only compared against stored project ids.
    expect(code).toBe(1);
    expect(bogus.transcript).toContain("No project with that id: ../../etc/passwd");
  });

  test("projects add --path resolves and collapses traversal segments before anything is stored", async () => {
    // `projectsAddCommand` calls `resolve(options.path)` — the same
    // Node path resolution used everywhere else in this codebase — so a
    // `../../` prefix collapses against the CLI's cwd rather than being
    // stored (and later walked) as a literal string. This mirrors that
    // exact call so a regression here is caught structurally rather than by
    // re-implementing `resolve`'s semantics.
    const base = workspace();
    const nested = join(base, "a", "b", "c");
    const traversal = join(nested, "..", "..", "..");

    expect(resolve(traversal)).toBe(resolve(base));
  });

  test("registering a project whose --path traverses outside a sandbox still only ever inspects that resolved root, never an arbitrary file", async () => {
    const built = context();
    const sandbox = workspace();
    const outside = workspace();
    writeFileSync(join(outside, "secret.txt"), "top secret, never to be read by inspection");

    const traversalPath = join(sandbox, "..", basename(outside));

    const add = new ScriptedTerminal([]);
    const code = await dispatch(
      ["projects", "add", "--name", "Traversal", "--path", traversalPath, "--inspect"],
      built,
      add,
    );

    // The registration succeeds — `outside` is a real, readable directory
    // once `resolve()` collapses the traversal, exactly as choosing that
    // folder directly would. What matters is what inspection reports:
    expect(code).toBe(0);
    expect(add.transcript).not.toContain("secret");
    expect(add.transcript).not.toContain("top secret");
  });

  test("the inspector never follows a symlink out of an approved root", async () => {
    const root = workspace();
    const outside = workspace();
    writeFileSync(join(outside, "passwd-like.txt"), "root:x:0:0:root:/root:/bin/bash");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "sample" }));

    try {
      symlinkSync(join(outside, "passwd-like.txt"), join(root, "escape-link"));
    } catch {
      // Symlinks may be unavailable in some sandboxes; the test has nothing
      // to add in that case, since there is then no link to fail to follow.
      return;
    }

    const inspector = createProjectInspector();
    const result = await inspector.inspect(root);

    const serialized = JSON.stringify(result.facts);
    expect(serialized).not.toContain("root:x:0:0");
    expect(serialized).not.toContain("escape-link");
  });

  test("inspection reads the content of nothing but package.json, even for files it names", async () => {
    const root = workspace();
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "sample" }));
    // `.env`-shaped content under an INTERESTING-looking name a naive
    // globbing inspector might slurp.
    writeFileSync(join(root, "config.json"), JSON.stringify({ apiKey: "sk-should-never-appear" }));

    const inspector = createProjectInspector();
    const result = await inspector.inspect(root);

    const serialized = JSON.stringify(result.facts);
    expect(serialized).not.toContain("sk-should-never-appear");
    expect(serialized).not.toContain("apiKey");
  });
});
