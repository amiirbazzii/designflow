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
  test("extracts the complete React TypeScript design-system fixture context", async () => {
    const root = mkdtempSync(join(tmpdir(), "df-inspector-deep-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "vite-fixture",
        scripts: { build: "tsc -b && vite build", lint: "oxlint" },
        dependencies: { react: "^19.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }));
      writeFileSync(join(root, "package-lock.json"), "{}\n");
      writeFileSync(join(root, ".env"), "DESIGNFLOW_TEST_SECRET=must-never-leak\n");
      mkdirSync(join(root, "src", "components"), { recursive: true });
      mkdirSync(join(root, "src", "styles"), { recursive: true });
      writeFileSync(join(root, "src", "styles", "tokens.css"), ":root { --color-primary: #635bff; --spacing-md: 16px; }\n");
      writeFileSync(join(root, "src", "components", "Button.tsx"), [
        "export interface ButtonProps {",
        "  children: React.ReactNode;",
        "  variant?: \"primary\" | \"secondary\";",
        "  disabled?: boolean;",
        "}",
        "export function Button({ children }: ButtonProps) { return <button>{children}</button>; }",
      ].join("\n"));

      const inspector = createProjectInspector();
      const first = await inspector.inspect(root);
      const second = await inspector.inspect(root);
      const byKey = Object.fromEntries(first.facts.map((fact) => [fact.key, fact.value]));

      expect(first).toEqual(second);
      expect(byKey["project.frameworks"]).toEqual(["react"]);
      expect(byKey["project.language"]).toBe("typescript");
      expect(byKey["project.packageManager"]).toBe("npm");
      expect(byKey["project.sourceRoot"]).toBe("src");
      expect(byKey["project.styling"]).toEqual(["css"]);
      expect(byKey["designSystem.tokenSources"]).toEqual([{ path: "src/styles/tokens.css", kind: "css-variables" }]);
      expect(byKey["designSystem.tokens"]).toEqual([
        { name: "color-primary", value: "#635bff", reference: "var(--color-primary)", sourcePath: "src/styles/tokens.css" },
        { name: "spacing-md", value: "16px", reference: "var(--spacing-md)", sourcePath: "src/styles/tokens.css" },
      ]);
      expect(byKey["designSystem.components"]).toEqual([
        { name: "Button", sourcePath: "src/components/Button.tsx", props: ["children", "variant", "disabled"] },
      ]);
      expect(byKey["project.commands"]).toEqual(["build", "lint"]);
      expect(JSON.stringify(first.facts)).not.toContain("must-never-leak");

      writeFileSync(join(root, "src", "styles", "tokens.css"), ":root { --color-primary: #000000; --spacing-md: 16px; }\n");
      const changed = await inspector.inspect(root);
      expect(changed).not.toEqual(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  test("extracts supported route and component destinations from project evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "df-inspector-destinations-"));
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({
        name: "destination-fixture",
        dependencies: { react: "^18.0.0" },
      }));
      mkdirSync(join(root, "src", "app", "dashboard"), { recursive: true });
      mkdirSync(join(root, "src", "components"), { recursive: true });
      writeFileSync(join(root, "src", "app", "dashboard", "page.tsx"), "export default function Dashboard() { return null; }");
      writeFileSync(join(root, "src", "components", "ExpenseForm.tsx"), "export function ExpenseForm() { return null; }");
      writeFileSync(join(root, "src", "App.tsx"), 'export function App() { return <Routes><Route path="/expenses" /></Routes>; }');
      writeFileSync(join(root, "src", "Shell.tsx"), '<a href="/invented">Not a route declaration</a>');

      const { facts } = await createProjectInspector().inspect(root);
      const destinations = facts.find((fact) => fact.key === "project.destinations")?.value;

      expect(destinations).toEqual([
        { kind: "page", label: "/dashboard", sourcePath: "src/app/dashboard/page.tsx" },
        { kind: "page", label: "/expenses", sourcePath: "src/App.tsx" },
        { kind: "component", label: "ExpenseForm", sourcePath: "src/components/ExpenseForm.tsx" },
      ]);
      expect(JSON.stringify(destinations)).not.toContain("/invented");
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
