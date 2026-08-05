import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRegisteredProject } from "./inspection";
import { applyAndValidateProject } from "./run";
import { validateProject } from "./validation";

const roots: string[] = [];

async function fixture(options: { manager?: "npm" | "bun" | "pnpm" | "yarn"; build?: string; lint?: string } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "designflow-validation-"));
  roots.push(root);
  const manager = options.manager ?? "npm";
  const lockName = manager === "npm" ? "package-lock.json" : manager === "bun" ? "bun.lock" : manager === "pnpm" ? "pnpm-lock.yaml" : "yarn.lock";
  await writeFile(join(root, lockName), "\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "validation-fixture",
    scripts: {
      build: options.build ?? "node -e \"process.stdout.write('build ok')\"",
      ...(options.lint !== undefined ? { lint: options.lint } : {}),
    },
    dependencies: { react: "18.0.0" },
  }));
  await mkdir(join(root, "src"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("validation cancellation", () => {
  test("a pre-aborted signal stops validation before any command starts, with no report", async () => {
    const marker = join(tmpdir(), `designflow-abort-marker-${crypto.randomUUID()}`);
    const root = await fixture({
      build: `node -e "require('fs').writeFileSync('${marker}', 'ran')"`,
    });
    const context = inspectRegisteredProject({ id: "abort-project", name: "Abort", rootPath: root });

    const controller = new AbortController();
    controller.abort();

    await expect(validateProject(context, root, { signal: controller.signal })).rejects.toThrow(
      "cancelled before completion",
    );
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(false);
  });

  test("aborting mid-command kills the child and throws instead of producing a partial verdict", async () => {
    const root = await fixture({
      // Blocks until killed: reads stdin that never arrives... use a long sleep loop.
      build: "node -e \"setInterval(() => {}, 1000)\"",
    });
    const context = inspectRegisteredProject({ id: "abort-mid", name: "AbortMid", rootPath: root });

    const controller = new AbortController();
    const pending = validateProject(context, root, {
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    // Deterministic enough: the abort listener kills the child whenever the
    // spawn completes; the promise then rejects via throwIfCancelled.
    controller.abort();

    await expect(pending).rejects.toThrow("cancelled before completion");
  });
});

describe("Stage 4 declared validation commands", () => {
  test("discovers compound npm build and lint scripts as package-manager argv", async () => {
    const root = await fixture({
      build: "node scripts/fail-if-header-exists.mjs && tsc -b && vite build",
      lint: "oxlint",
    });
    const context = inspectRegisteredProject({ id: "npm-project", name: "Npm", rootPath: root });

    expect(context.commands.build).toMatchObject({ executable: "npm", args: ["run", "build"], required: true });
    expect(context.commands.lint).toMatchObject({ executable: "npm", args: ["run", "lint"], required: true });
  });

  test.each([
    ["bun", "bun", ["run", "build"]],
    ["pnpm", "pnpm", ["run", "build"]],
    ["yarn", "yarn", ["build"]],
  ] as const)("constructs the safe %s build invocation", async (manager, executable, args) => {
    const root = await fixture({ manager });
    const context = inspectRegisteredProject({ id: `${manager}-project`, name: manager, rootPath: root });
    expect(context.commands.build).toMatchObject({ executable, args, required: true });
  });

  test("reads current package scripts and changes the fingerprint", async () => {
    const root = await fixture({ build: "node -e \"process.stdout.write('one')\"" });
    const first = inspectRegisteredProject({ id: "current-project", name: "Current", rootPath: root });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "validation-fixture", scripts: { build: "node -e \"process.stdout.write('two')\"" } }));
    const second = inspectRegisteredProject({ id: "current-project", name: "Current", rootPath: root });
    expect(first.commands.build?.args).toEqual(["run", "build"]);
    expect(second.commands.build?.args).toEqual(["run", "build"]);
    expect(second.project.contextFingerprint).not.toBe(first.project.contextFingerprint);
  });

  test("runs a declared build with argv, records failure, and rolls back the created file", async () => {
    const root = await fixture({ build: "node scripts/fail-if-header-exists.mjs && tsc -b && vite build" });
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "scripts", "fail-if-header-exists.mjs"), "import { existsSync } from 'node:fs';\nif (existsSync(new URL('../src/Header.tsx', import.meta.url))) { console.error('Controlled Stage 4 validation failure'); process.exit(1); }\n");
    const context = inspectRegisteredProject({ id: "rollback-project", name: "Rollback", rootPath: root });
    const result = await applyAndValidateProject({
      projectId: "rollback-project",
      root,
      rootIdentity: context.project.rootIdentity,
      stateDirectory: await mkdtemp(join(tmpdir(), "designflow-validation-state-")),
      proposal: {
        schemaVersion: "1",
        projectId: "rollback-project",
        baseProjectFingerprint: context.project.contextFingerprint,
        files: [{ path: "src/Header.tsx", action: "create", content: "export function Header() {}\n", reason: "test", relatedDesignNodeIds: [] }],
        packageChanges: [],
        commandsRequested: [{ name: "build", required: true }],
        assumptions: [],
        unresolvedItems: [],
      },
      context,
      proposalArtifactId: "proposed-file-changes",
      applicationArtifactId: "file-application-result",
      validationArtifactId: "implementation-validation",
    });

    expect(result.report.passed).toBe(false);
    expect(result.report.rollbackTriggered).toBe(true);
    expect(result.report.checks).toContainEqual(expect.objectContaining({
      name: "build",
      status: "failed",
      required: true,
      command: ["npm", "run", "build"],
      exitCode: 1,
    }));
    const build = result.report.checks.find((check) => check.name === "build");
    expect(build?.stderr).toContain("Controlled Stage 4 validation failure");
    expect(build?.summary).not.toContain("must-never-leak");
    await expect(Bun.file(join(root, "src/Header.tsx")).exists()).resolves.toBe(false);
  });

  test("missing optional scripts remain honestly unavailable", async () => {
    const root = await fixture();
    const context = inspectRegisteredProject({ id: "optional-project", name: "Optional", rootPath: root });
    const checks = await validateProject(context, root);
    expect(checks.find((check) => check.name === "lint")).toMatchObject({ status: "unavailable", required: false });
    expect(checks.find((check) => check.name === "build")).toMatchObject({ status: "passed", required: true, command: ["npm", "run", "build"] });
  });

  test("uses shell-free argv and redacts bounded command output", async () => {
    const root = await fixture({
      build: "node -e \"console.error('DESIGNFLOW_TEST_SECRET=must-never-leak-7f82c'); process.exit(1)\"",
    });
    const source = await Bun.file(new URL("./validation.ts", import.meta.url)).text();
    expect(source).toContain("shell: false");
    expect(source).not.toContain("shell: true");

    const context = inspectRegisteredProject({ id: "secret-project", name: "Secret", rootPath: root });
    const checks = await validateProject(context, root);
    const build = checks.find((check) => check.name === "build");
    expect(build).toMatchObject({ status: "failed", required: true, command: ["npm", "run", "build"] });
    expect(`${build?.stdout ?? ""}\n${build?.stderr ?? ""}`).not.toContain("must-never-leak-7f82c");
    expect(`${build?.stdout ?? ""}\n${build?.stderr ?? ""}`).toContain("[REDACTED]");
  });
});
