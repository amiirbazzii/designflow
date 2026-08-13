// packages/tools/src/architecture.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The tool layer's dependency boundary.
 *
 * Tools inform a decision; they never perform work. That is a property of what
 * this package is *allowed to import*, not of how carefully it is written, so
 * it is checked mechanically. A tool that reached a repository or a runner
 * would be a capability wearing a disguise — producing output the engine never
 * recorded, cannot reuse and cannot explain.
 *
 * `node:fs` is deliberately NOT forbidden here: `project-summary` reads a
 * directory, and this package is exactly where such a grant belongs. What is
 * forbidden is writing — see the mutation test below.
 */

function sources(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      // A feature's tests, fixtures and helpers live in its own `test/`
      // directory beside its runtime files. They are test-only by location —
      // a fixture that writes a temporary project tree is exactly what a
      // filesystem-mutation guard should ignore, and exactly what it would
      // otherwise flag.
      if (entry === "test") continue;
      found.push(...sources(path));
      continue;
    }

    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(path);
  }

  return found;
}

/**
 * A source file with its comments removed.
 *
 * The prose in this package names the things it must not touch — explaining
 * that the runtime does not call `WorkflowRunner` requires writing
 * `WorkflowRunner`. Scanning the code alone keeps the rule about what the
 * package *does* rather than about what it is allowed to discuss.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FORBIDDEN = [
  "@designflow/core",
  "@designflow/artifacts",
  "@designflow/state",
  "@designflow/storage-file",
  "@designflow/storage-sqlite",
  "@designflow/product",
  "@designflow/workers",
  "@designflow/agents",
  "designflow-cli",
];

describe("the tools package depends on the SDK alone", () => {
  test("imports no engine, storage, product or CLI package", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      for (const pkg of FORBIDDEN) {
        if (contents.includes(pkg)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${pkg}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("declares only the SDK and Zod as dependencies", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    );

    const dependencies =
      typeof manifest === "object" && manifest !== null && "dependencies" in manifest
        ? manifest.dependencies
        : {};

    expect(Object.keys(dependencies as Record<string, string>).sort()).toEqual([
      "@designflow/sdk",
      "zod",
    ]);
  });

  test("names no repository, artifact store or execution service", () => {
    // The runtime creates a decision. Nothing it touches can run one.
    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      for (const forbidden of [
        "ExecutionService",
        "ExecutionRepository",
        "WorkflowRunner",
        "ArtifactStore",
        "ArtifactRegistry",
        "ApprovalManager",
        "EventPublisher",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("never mutates a filesystem, spawns a process or opens a socket", () => {
    // A read-only tool is only read-only if it cannot write. Every mutating
    // and executing `node:` API is named rather than trusted to be absent.
    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      for (const forbidden of [
        "writeFile",
        "appendFile",
        "mkdir",
        "rmdir",
        "unlink",
        "rename",
        "copyFile",
        "chmod",
        "createWriteStream",
        "node:child_process",
        "spawn",
        "execSync",
        "node:net",
        "node:http",
        "fetch(",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("prints nothing", () => {
    // A library package logs through the SDK `Logger`, never to a terminal.
    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      expect(contents).not.toContain("console.");
      expect(contents).not.toContain("process.stdout");
    }
  });

  test("carries no LLM or agent-tool dependency", () => {
    // Stage 35 is contracts and a boundary. Tools, memory and model calls are
    // later stages, and a placeholder for them now would be an interface
    // invented before there was a caller to shape it.
    for (const path of sources(import.meta.dir)) {
      const contents = code(path);

      for (const forbidden of ["@ai-sdk/", "openai", "anthropic", "langchain"]) {
        expect(contents.toLowerCase()).not.toContain(forbidden);
      }
    }
  });
});
