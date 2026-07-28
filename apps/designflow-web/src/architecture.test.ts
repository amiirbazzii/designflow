// apps/designflow-web/src/architecture.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The web client's architectural guard.
 *
 * The MVP's tiering only holds if the browser bundle cannot reach the engine.
 * Asserting it in a test means a future contributor who adds the import gets a
 * failure rather than a working build and a broken boundary.
 */

const ENGINE_PACKAGES = [
  "@designflow/core",
  "@designflow/storage-sqlite",
  "@designflow/artifacts",
  "@designflow/state",
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }

    // Test sources are excluded: this file names the very packages it
    // forbids, and would otherwise flag itself.
    if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      found.push(path);
    }
  }

  return found;
}

describe("web application boundaries", () => {
  test("never imports the engine or a storage backend", () => {
    const offenders: string[] = [];

    for (const path of sourceFiles(import.meta.dir)) {
      const contents = readFileSync(path, "utf8");

      for (const pkg of ENGINE_PACKAGES) {
        if (contents.includes(pkg)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${pkg}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("talks to DesignFlow only through the product layer and the API", () => {
    const client = readFileSync(join(import.meta.dir, "api-client.ts"), "utf8");

    // Product types and schemas, and nothing else from the platform.
    expect(client).toContain("@designflow/product");
    expect(client).toContain("/api/");
  });

  test("every network call goes through the api client", () => {
    const offenders: string[] = [];

    for (const path of sourceFiles(import.meta.dir)) {
      if (path.endsWith("api-client.ts")) continue;
      if (path.endsWith(".test.ts")) continue;

      if (readFileSync(path, "utf8").includes("fetch(")) {
        offenders.push(path.split("/").slice(-2).join("/"));
      }
    }

    // One place parses responses, so one place enforces the contract.
    expect(offenders).toEqual([]);
  });
});
