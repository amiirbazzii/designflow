// packages/sdk/src/architecture/test/feature-test-layout.test.ts
//
// The repository-wide structural guardrail for V2 feature modules.
//
//   feature/
//   ├── runtime files
//   ├── README.md
//   └── test/          ← every test, fixture and helper the feature owns
//
// Two rules, both checkable from the tree alone:
//
//   1. A test file under a V2 feature module lives in that feature's own
//      `test/` directory. A `*.test.ts` sitting beside the file it tests is
//      the pattern this refactor removed, and the one new work drifts back to
//      without a guard.
//
//   2. Nothing under a `test/` directory is ever imported by runtime code.
//      Tests may reach into the module; the module must never reach back out.
//
// The check runs from the repository root and covers every package, so a new
// feature added tomorrow is held to the same shape without touching this file.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPOSITORY_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/** Source roots this rule governs. Test-only packages are their own thing. */
const GOVERNED_ROOTS = [
  "packages/sdk/src",
  "packages/agents/src",
  "packages/tools/src",
  "packages/models/src",
  "packages/product/src",
  "packages/capabilities/figma-mcp/src",
  "packages/capabilities/implementation/src",
  "workflows/workflow-design-to-code/src",
];

/**
 * Package roots holding generic infrastructure rather than a feature.
 *
 * Every Design-to-Code feature now owns a module with its own `test/`
 * directory. What remains flat at these roots is shared machinery that serves
 * every workflow — the agent runtime and its registries, the model runtime,
 * the product session/worker services, the generic SDK contracts — and a file
 * there is expected to be generic. Adding a Design-to-Code feature file to one
 * of these is the regression `noDesignToCodeFileInGenericRoot` catches.
 */
const GENERIC_INFRASTRUCTURE_ROOTS = new Set([
  "packages/sdk/src",
  "packages/agents/src",
  "packages/tools/src",
  "packages/tools/src/catalog",
  "packages/models/src",
  "packages/product/src",
  "packages/capabilities/figma-mcp/src",
  "packages/capabilities/implementation/src",
  "workflows/workflow-design-to-code/src",
]);

/**
 * Design-to-Code concepts that must live in a named feature module.
 *
 * The check is on file names rather than contents: a file called
 * `visual-correction-agent.ts` in a generic `catalog/` is exactly the drift
 * this whole reorganization removed.
 */
const FEATURE_OWNED_NAMES = [
  "figma-specification",
  "design-interpreter",
  "ui-blueprint",
  "project-mapper",
  "project-context",
  "implementation-agent",
  "visual-validation",
  "visual-correction",
  "proposed-state",
  "coverage",
  "approval",
  "rollback",
  "snapshot",
];

/** Generic directories a Design-to-Code feature file must never be dumped into. */
const PROHIBITED_GENERIC_DIRECTORIES = [
  "packages/agents/src/catalog",
  "packages/tools/src/catalog",
];

function walk(directory: string, visit: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, visit);
      continue;
    }
    visit(path);
  }
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

const TEST_FILE = /\.(test|spec)\.tsx?$/;

describe("V2 feature modules own their tests in a local test/ directory", () => {
  test("no test file sits directly beside the runtime file it covers", () => {
    const offenders: string[] = [];

    for (const root of GOVERNED_ROOTS) {
      walk(join(REPOSITORY_ROOT, root), (path) => {
        const relativePath = posix(relative(REPOSITORY_ROOT, path));
        if (!TEST_FILE.test(relativePath)) return;
        // Allowed: anywhere under a `test/` segment.
        if (relativePath.includes("/test/")) return;
        const directory = relativePath.split("/").slice(0, -1).join("/");
        if (GENERIC_INFRASTRUCTURE_ROOTS.has(directory)) return;
        offenders.push(relativePath);
      });
    }

    expect(offenders).toEqual([]);
  });

  test("runtime code never imports from a test directory", () => {
    const offenders: string[] = [];

    for (const root of GOVERNED_ROOTS) {
      walk(join(REPOSITORY_ROOT, root), (path) => {
        const relativePath = posix(relative(REPOSITORY_ROOT, path));
        if (!relativePath.endsWith(".ts") && !relativePath.endsWith(".tsx")) return;
        if (TEST_FILE.test(relativePath) || relativePath.includes("/test/")) return;

        const contents = readFileSync(path, "utf8");
        for (const match of contents.matchAll(/from\s+"([^"]+)"/g)) {
          const specifier = match[1]!;
          if (/(^|\/)test\//.test(specifier) || specifier.includes("/fixtures/")) {
            offenders.push(`${relativePath} → ${specifier}`);
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  test("no Design-to-Code feature file sits in a generic catalog directory", () => {
    const offenders: string[] = [];

    for (const directory of PROHIBITED_GENERIC_DIRECTORIES) {
      walk(join(REPOSITORY_ROOT, directory), (path) => {
        const relativePath = posix(relative(REPOSITORY_ROOT, path));
        const name = relativePath.split("/").at(-1) ?? "";
        if (FEATURE_OWNED_NAMES.some((concept) => name.includes(concept))) offenders.push(relativePath);
      });
    }

    expect(offenders).toEqual([]);
  });

  test("every migrated Design-to-Code module keeps its tests locally", () => {
    const modules = [
      "packages/agents/src/project-mapper",
      "packages/agents/src/ui-blueprint",
      "packages/agents/src/design-interpreter",
      "packages/agents/src/design-engineer",
      "packages/agents/src/implementation",
      "packages/agents/src/visual-validation",
      "packages/agents/src/visual-correction",
      "packages/agents/src/specification/evidence",
      "packages/agents/src/specification/compatibility",
      "packages/agents/src/specification/legacy",
      "packages/sdk/src/project-context",
      "packages/sdk/src/visual-validation",
      "packages/sdk/src/visual-correction",
      "packages/tools/src/project-context",
      "packages/capabilities/figma-mcp/src/desktop",
      "packages/capabilities/figma-mcp/src/source",
      "packages/capabilities/figma-mcp/src/transport",
      "packages/capabilities/figma-mcp/src/normalization",
      "packages/capabilities/figma-mcp/src/snapshot",
      "packages/capabilities/figma-mcp/src/screenshot",
      "packages/capabilities/implementation/src/proposal",
      "packages/capabilities/implementation/src/project-mutation",
      "packages/capabilities/implementation/src/validation",
      "workflows/workflow-design-to-code/src/orchestration",
      "workflows/workflow-design-to-code/src/figma-specification",
      "workflows/workflow-design-to-code/src/implementation",
      "workflows/workflow-design-to-code/src/visual-validation",
      "workflows/workflow-design-to-code/src/visual-correction",
    ];

    for (const module of modules) {
      const tests: string[] = [];
      walk(join(REPOSITORY_ROOT, module, "test"), (path) => {
        if (TEST_FILE.test(path)) tests.push(path);
      });
      expect({ module, hasTests: tests.length > 0 }).toEqual({ module, hasTests: true });
    }
  });
});
