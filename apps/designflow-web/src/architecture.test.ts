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

  test("InputForm derives its fields from the server, not a hardcoded per-workflow table", () => {
    // Regression: an earlier version hardcoded design-to-code's three
    // fields in a `FIELDS` table keyed by workflow id, so any other
    // workflow — including all three added this stage — silently got an
    // empty form. Fields must now come from `props.workflow.inputs`.
    const source = readFileSync(join(import.meta.dir, "screens/InputForm.tsx"), "utf8");

    expect(source).toContain("props.workflow.inputs");
    expect(source).not.toContain("homepage.fig");
    expect(source).not.toMatch(/const FIELDS/);
  });

  test("the worker schema names no internal id — a worker response is never a workflow/agent id carrier", () => {
    const client = readFileSync(join(import.meta.dir, "api-client.ts"), "utf8");
    const workerSchemaSource = client.slice(
      client.indexOf("const workerSummarySchema"),
      client.indexOf("export type WorkerSummary"),
    );

    for (const forbidden of ["agentId", "workflowId", "modelProfileId"]) {
      expect(workerSchemaSource).not.toContain(forbidden);
    }
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
