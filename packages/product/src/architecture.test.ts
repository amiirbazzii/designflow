// packages/product/src/architecture.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The product layer no longer wires a concrete workflow.
 *
 * `packages/product` owns the user-facing concepts — Worker, Session,
 * Result — but a worker's input/output schemas used to be imported directly
 * from the workflow package that defines them (`@designflow/workflow-*`).
 * That created a dependency cycle in spirit: the product layer, which every
 * composition root depends on, depended back down on a concrete workflow.
 * This stage's fix has schemas injected by the composition root instead
 * (each app's host.ts, or the CLI's services/cli-runner.ts), so
 * "packages/product" itself should name no workflow package at all — not in
 * a real source file, not in package.json, not in tsconfig.json.
 *
 * This is checked mechanically rather than trusted, because the failure mode
 * is exactly the kind of thing that creeps back in one convenience import at
 * a time: a future contributor reaching for a workflow's schema "just this
 * once" re-opens the cycle this stage closed.
 */

function realSources(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...realSources(path));
      continue;
    }

    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(path);
  }

  return found;
}

/**
 * A source file with its comments removed.
 *
 * The prose explaining *why* this package must not import a workflow package
 * legitimately needs to name one (see the block comment above, and the one
 * that will inevitably follow it in `schemas.ts`). Scanning code alone keeps
 * the rule about what the package *imports*, not about what it discusses.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const WORKFLOW_PACKAGE_PATTERN = /@designflow\/workflow-[a-z-]+/g;

describe("the product layer never depends on a concrete workflow", () => {
  test("no real source file imports an @designflow/workflow-* package", () => {
    const offenders: string[] = [];

    for (const path of realSources(import.meta.dir)) {
      const matches = code(path).match(WORKFLOW_PACKAGE_PATTERN);

      if (matches) {
        offenders.push(`${path.split("/").slice(-2).join("/")} → ${matches.join(", ")}`);
      }
    }

    // Worker/Session/Result schemas are injected by the composition root
    // (host.ts / cli-runner.ts) now, precisely so this list stays empty.
    expect(offenders).toEqual([]);
  });

  test("test files may mention a workflow package only in prose, never import one", () => {
    // Weaker than the source check above (comments left in), because a test
    // legitimately narrates which workflow package owns a fixture it stands
    // in for. What it must never do is actually import one — that would
    // smuggle the same dependency back in through the test suite.
    const offenders: string[] = [];

    for (const entry of readdirSync(import.meta.dir)) {
      if (!entry.endsWith(".test.ts")) continue;

      const path = join(import.meta.dir, entry);
      const importLines = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line));

      for (const line of importLines) {
        if (WORKFLOW_PACKAGE_PATTERN.test(line)) {
          offenders.push(`${entry} → ${line.trim()}`);
        }
        WORKFLOW_PACKAGE_PATTERN.lastIndex = 0;
      }
    }

    expect(offenders).toEqual([]);
  });

  test("package.json names no workflow package, in dependencies or devDependencies", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    );

    const record = manifest as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeclared = [
      ...Object.keys(record.dependencies ?? {}),
      ...Object.keys(record.devDependencies ?? {}),
    ];

    const offenders = allDeclared.filter((name) => name.startsWith("@designflow/workflow-"));

    expect(offenders).toEqual([]);
  });

  test("tsconfig.json references no workflow package", () => {
    const tsconfig: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "tsconfig.json"), "utf8"),
    );

    const references =
      typeof tsconfig === "object" && tsconfig !== null && "references" in tsconfig
        ? (tsconfig as { references: Array<{ path: string }> }).references
        : [];

    const offenders = references.filter((reference) => reference.path.includes("workflow-"));

    expect(offenders).toEqual([]);
  });
});
