// packages/tools/src/catalog/project-inspector.test.ts
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectInspector } from "./project-inspector";

/**
 * The product-facing inspector, exercised the same way `registry.test.ts`
 * exercises the agent-facing tool — same containment guarantees, different
 * caller shape (a fresh root per call rather than one fixed at construction).
 */

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "df-inspector-"));

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "sample-project",
      packageManager: "pnpm@9.0.0",
      dependencies: { react: "^18.0.0", "acme-design-system": "^1.0.0" },
      devDependencies: { vitest: "^1.0.0" },
    }),
  );
  writeFileSync(join(root, ".env"), "API_KEY=super-secret-value");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "App.tsx"), "");
  mkdirSync(join(root, "design-system"));

  return root;
}

describe("createProjectInspector", () => {
  test("produces inspection facts for name, package manager, frameworks, test framework, source root", async () => {
    const root = workspace();
    try {
      const { facts } = await createProjectInspector().inspect(root);
      const byKey = Object.fromEntries(facts.map((fact) => [fact.key, fact]));

      expect(byKey["project.name"]).toMatchObject({ value: "sample-project", source: "inspection" });
      expect(byKey["project.packageManager"]).toMatchObject({ value: "pnpm", source: "inspection" });
      expect(byKey["project.frameworks"]).toMatchObject({ value: ["react"], source: "inspection" });
      expect(byKey["project.testFramework"]).toMatchObject({ value: "vitest", source: "inspection" });
      expect(byKey["project.sourceRoot"]).toMatchObject({ value: "src", source: "inspection" });
      expect(byKey["designSystem.package"]).toMatchObject({
        value: "acme-design-system",
        source: "inspection",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a design-system-named directory is inferred, not asserted, with confidence", async () => {
    const root = workspace();
    try {
      const { facts } = await createProjectInspector().inspect(root);
      const fact = facts.find((candidate) => candidate.key === "designSystem.path");

      expect(fact).toMatchObject({ value: "design-system", source: "inferred" });
      expect(fact?.confidence).toBeGreaterThan(0);
      expect(fact?.confidence).toBeLessThan(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a nested monorepo design-system directory (packages/ui) is also detected", async () => {
    const root = mkdtempSync(join(tmpdir(), "df-inspector-nested-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "monorepo", dependencies: { react: "^18.0.0" } }));
      mkdirSync(join(root, "packages", "ui"), { recursive: true });

      const { facts } = await createProjectInspector().inspect(root);
      const fact = facts.find((candidate) => candidate.key === "designSystem.path");

      expect(fact).toMatchObject({ value: "packages/ui", source: "inferred" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("never reports secret-like file contents or names", async () => {
    const root = workspace();
    try {
      const { facts } = await createProjectInspector().inspect(root);
      const serialized = JSON.stringify(facts);

      expect(serialized).not.toContain(".env");
      expect(serialized).not.toContain("super-secret-value");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects an unreadable root without echoing the path", async () => {
    await expect(createProjectInspector().inspect("/no/such/directory")).rejects.toThrow(
      "That project directory could not be read.",
    );
  });

  test("a symlink cannot be used to escape the root during traversal", async () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), "df-inspector-outside-"));

    try {
      writeFileSync(join(outside, "leaked.tsx"), "");
      symlinkSync(outside, join(root, "escape-hatch"));

      const { facts } = await createProjectInspector().inspect(root);
      expect(JSON.stringify(facts)).not.toContain("leaked.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("is deterministic across calls", async () => {
    const root = workspace();
    try {
      const inspector = createProjectInspector();
      expect(await inspector.inspect(root)).toEqual(await inspector.inspect(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
