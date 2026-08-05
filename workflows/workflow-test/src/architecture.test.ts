// workflow-test/src/architecture.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * This workflow's dependency and determinism boundary.
 *
 * A workflow package must be deterministic-only — no model call, no network
 * call — and, in real (non-test) code, must depend on nothing but the SDK.
 * That is a property of what this package is *allowed to import and call*,
 * not of how carefully it is written, so it is checked mechanically. A stray
 * `fetch(` or a dependency on `@designflow/core` here would mean this
 * package is no longer safely re-runnable and pure — exactly what a
 * deterministic workflow promises its caller.
 *
 * workflow package test support is deliberately excluded from the production
 * source tree and imported only by tests.
 * this package's own `*.test.ts` files (never by real `src` code) and exists
 * solely to give tests a throwaway `@designflow/core` + `@designflow/product`
 * harness to run the workflow end to end. It is the test-only equivalent of a
 * devDependency, named as such in its own header comment.
 */

function realSources(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...realSources(path));
      continue;
    }

    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".test-support.ts")) continue;

    found.push(path);
  }

  return found;
}

const FORBIDDEN_PACKAGES = [
  "@designflow/core",
  "@designflow/product",
  "@designflow/agents",
  "@designflow/workers",
  "@designflow/models",
  "@designflow/model-provider-openrouter",
  "@designflow/tools",
  "@designflow/artifacts",
  "@designflow/state",
  "@designflow/storage-file",
  "@designflow/storage-sqlite",
];

const NETWORK_OR_MODEL_MARKERS = [
  "fetch(",
  "ModelInvoker",
  "node:http",
  "node:https",
  "node:net",
  "XMLHttpRequest",
  "@ai-sdk/",
  "openai",
  "anthropic",
  "langchain",
];

describe("this workflow package is deterministic and depends on the SDK alone", () => {
  test("no real source file imports another engine, product or model package", () => {
    const offenders: string[] = [];

    for (const path of realSources(import.meta.dir)) {
      const contents = readFileSync(path, "utf8");

      for (const pkg of FORBIDDEN_PACKAGES) {
        if (contents.includes(pkg)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${pkg}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no real source file makes a network or model call", () => {
    const offenders: string[] = [];

    for (const path of realSources(import.meta.dir)) {
      const contents = readFileSync(path, "utf8").toLowerCase();

      for (const marker of NETWORK_OR_MODEL_MARKERS) {
        if (contents.includes(marker.toLowerCase())) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${marker}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("declares no real (non-test) dependency beyond the SDK", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
    );

    const dependencies =
      typeof manifest === "object" && manifest !== null && "dependencies" in manifest
        ? (manifest as { dependencies: Record<string, string> }).dependencies
        : {};

    // `@designflow/sdk` is the contract every workflow is built against.
    // Anything else here — `@designflow/core`, `@designflow/product`, a
    // capability's own package — would mean this workflow's *published*
    // artifact carries a dependency its caller never asked for. `zod` and a
    // capability's own artifact package (used only for typed I/O, never for
    // execution) are the only exceptions this repo's workflow packages take.
    for (const name of Object.keys(dependencies)) {
      expect(
        name === "@designflow/sdk" ||
          name === "zod" ||
          name.startsWith("@designflow/capability-"),
      ).toBe(true);
    }
    expect(Object.keys(dependencies)).toContain("@designflow/sdk");
  });

  test("the tsconfig references no package beyond the SDK", () => {
    const tsconfig: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "tsconfig.json"), "utf8"),
    );

    const references =
      typeof tsconfig === "object" && tsconfig !== null && "references" in tsconfig
        ? (tsconfig as { references: Array<{ path: string }> }).references
        : [];

    for (const reference of references) {
      expect(reference.path.includes("packages/core")).toBe(false);
      expect(reference.path.includes("packages/product")).toBe(false);
      expect(reference.path.includes("packages/agents")).toBe(false);
      expect(reference.path.includes("packages/workers")).toBe(false);
      expect(reference.path.includes("packages/models")).toBe(false);
    }
  });
});
