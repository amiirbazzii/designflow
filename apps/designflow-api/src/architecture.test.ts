// apps/designflow-api/src/architecture.test.ts
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The API's composition-root boundary.
 *
 * `host.ts` is the one file in this app allowed to name a concrete
 * implementation — the engine, a storage backend, the agent/tool/worker
 * layers and any `@designflow/workflow-*` package. Everything else (the
 * router, `main.ts`, `index.ts`) is meant to speak `@designflow/product` and
 * `@designflow/sdk` only, receiving already-wired collaborators through
 * `ApiHost` rather than constructing anything itself.
 *
 * This mirrors the equivalent guard already proven for the CLI
 * (`apps/designflow-cli/src/cli.test.ts`, "architecture" describe block) and
 * the demo (`apps/designflow-demo/src/app.test.ts`, "only the composition
 * root imports the engine") — the API was the one composition root of the
 * three named in this stage's invariants that had no such regression test
 * yet.
 */

const FORBIDDEN_PACKAGES = [
  "@designflow/core",
  "@designflow/storage-sqlite",
  "@designflow/storage-file",
  "@designflow/artifacts",
  "@designflow/state",
  "@designflow/agents",
  "@designflow/tools",
  "@designflow/workers",
  "@designflow/models",
  "@designflow/model-provider-openrouter",
];

const WORKFLOW_PACKAGE_PATTERN = /@designflow\/workflow-[a-z-]+/g;

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

describe("architecture", () => {
  test("only host.ts touches the engine, a storage backend, or the agent/tool/worker layers", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("/host.ts")) continue;

      const contents = readFileSync(path, "utf8");

      for (const pkg of FORBIDDEN_PACKAGES) {
        if (contents.includes(pkg)) {
          offenders.push(`${path.split("/").slice(-2).join("/")} → ${pkg}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("only host.ts names a concrete @designflow/workflow-* package", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("/host.ts")) continue;

      const matches = readFileSync(path, "utf8").match(WORKFLOW_PACKAGE_PATTERN);
      if (matches) {
        offenders.push(`${path.split("/").slice(-2).join("/")} → ${matches.join(", ")}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the router speaks only the SDK — no engine, product-internal, or workflow import", () => {
    const router = readFileSync(join(import.meta.dir, "router.ts"), "utf8");

    for (const pkg of [...FORBIDDEN_PACKAGES, "@designflow/product"]) {
      expect(router).not.toContain(pkg);
    }
    expect(router.match(WORKFLOW_PACKAGE_PATTERN)).toBeNull();
    expect(router).toContain("@designflow/sdk");
  });

  test("main.ts wires the host and the router but constructs nothing itself", () => {
    const main = readFileSync(join(import.meta.dir, "main.ts"), "utf8");

    expect(main).toContain("createApiHost");
    expect(main).toContain("createRouter");
    for (const pkg of FORBIDDEN_PACKAGES) {
      expect(main).not.toContain(pkg);
    }
  });
});
