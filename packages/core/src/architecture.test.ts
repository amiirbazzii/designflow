// packages/core/src/architecture.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The engine's dependency boundary, from the other side.
 *
 * `packages/agents` and `packages/tools` each already prove they depend on
 * nothing but the SDK. The mirror image of that guarantee is that the engine
 * they are decided and invoked *through* never reaches back down into a
 * worker, agent or model package — the engine executes a `WorkflowDefinition`
 * it was handed; it does not decide what to run or which model answers a
 * prompt. That direction of dependency is what makes "agents produce a
 * decision, something else acts on it" true of the whole system rather than
 * merely of the agent layer in isolation.
 *
 * Checked mechanically for the same reason every other architecture test in
 * this repo is: the day someone reaches for `@designflow/agents` from inside
 * the engine "just to look up which agent is running", this fails instead of
 * quietly re-opening the layering the composition root exists to keep.
 */

const FORBIDDEN = [
  "@designflow/workers",
  "@designflow/agents",
  "@designflow/models",
  "@designflow/model-provider-openrouter",
  "@designflow/tools",
  "@designflow/product",
];

function sources(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
      continue;
    }

    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(path);
  }

  return found;
}

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the core engine never reaches into a worker, agent or model package", () => {
  test("no real source file imports @designflow/workers, agents, models or a model provider", () => {
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

  test("package.json declares no dependency on a worker, agent or model package", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    );

    const record = manifest as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const declared = [
      ...Object.keys(record.dependencies ?? {}),
      ...Object.keys(record.devDependencies ?? {}),
    ];

    const offenders = declared.filter((name) => FORBIDDEN.includes(name));

    expect(offenders).toEqual([]);
  });

  test("tsconfig.json references no worker, agent or model package", () => {
    const tsconfig: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "tsconfig.json"), "utf8"),
    );

    const references =
      typeof tsconfig === "object" && tsconfig !== null && "references" in tsconfig
        ? (tsconfig as { references: Array<{ path: string }> }).references
        : [];

    const offenders = references.filter((reference) =>
      ["workers", "agents", "models", "model-provider", "tools", "product"].some((segment) =>
        reference.path.includes(segment),
      ),
    );

    expect(offenders).toEqual([]);
  });
});
