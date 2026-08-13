// packages/tools/src/project-context/test/alias-inspector.test.ts
//
// The gap this closes: `structure.aliases` was hardcoded `{}`, so every
// project looked alias-free. These tests pin what a declaration means, and
// keep "declared" distinguishable from "resolves to something that exists".
import { afterAll, describe, expect, test } from "bun:test";

import { writeProject, type FixtureProject } from "./fixtures/project-fixtures";
import { inspectProjectAliases, MAX_EXTENDS_DEPTH } from "../alias-inspector";

const fixtures: FixtureProject[] = [];
function fixture(files: Record<string, string>): FixtureProject {
  const project = writeProject(files);
  fixtures.push(project);
  return project;
}
afterAll(() => {
  for (const project of fixtures) project.cleanup();
});

const tsconfig = (value: unknown) => JSON.stringify(value, null, 2);

describe("alias discovery", () => {
  test("baseUrl and paths are read, with wildcard targets preserved verbatim", () => {
    const project = fixture({
      "tsconfig.json": tsconfig({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      "src/index.ts": "export {};\n",
    });
    const { aliases, baseUrl } = inspectProjectAliases(project.root);

    expect(baseUrl?.value).toBe(".");
    expect(baseUrl?.provenance).toMatchObject({ source: "tsconfig", path: "tsconfig.json", confidence: "deterministic" });
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ pattern: "@/*", targets: ["./src/*"], resolvedTargets: ["src"] });
  });

  test("multiple targets for one pattern are all kept", () => {
    const project = fixture({
      "tsconfig.json": tsconfig({ compilerOptions: { baseUrl: ".", paths: { "~/*": ["./src/*", "./legacy/*"] } } }),
      "src/a.ts": "export {};\n",
      "legacy/b.ts": "export {};\n",
    });
    const [alias] = inspectProjectAliases(project.root).aliases;
    expect(alias?.targets).toEqual(["./src/*", "./legacy/*"]);
    expect(alias?.resolvedTargets).toEqual(["src", "legacy"]);
  });

  test("a declared alias whose target does not exist stays visible and unresolved", () => {
    const project = fixture({
      "tsconfig.json": tsconfig({ compilerOptions: { baseUrl: ".", paths: { "@gone/*": ["./nope/*"] } } }),
      "src/index.ts": "export {};\n",
    });
    const [alias] = inspectProjectAliases(project.root).aliases;
    // declared but unresolved is a fact worth having — not a reason to hide it
    expect(alias?.pattern).toBe("@gone/*");
    expect(alias?.targets).toEqual(["./nope/*"]);
    expect(alias?.resolvedTargets).toEqual([]);
  });

  test("jsconfig is read when no tsconfig exists", () => {
    const project = fixture({
      "jsconfig.json": tsconfig({ compilerOptions: { baseUrl: "./src", paths: { "components/*": ["./components/*"] } } }),
      "src/components/Button.jsx": "export function Button() { return null; }\n",
    });
    const { aliases, baseUrl } = inspectProjectAliases(project.root);
    expect(baseUrl?.value).toBe("src");
    expect(aliases[0]?.provenance.source).toBe("jsconfig");
    expect(aliases[0]?.resolvedTargets).toEqual(["src/components"]);
  });

  test("tsconfig wins over jsconfig when both exist", () => {
    const project = fixture({
      "tsconfig.json": tsconfig({ compilerOptions: { baseUrl: ".", paths: { "@ts/*": ["./src/*"] } } }),
      "jsconfig.json": tsconfig({ compilerOptions: { paths: { "@js/*": ["./src/*"] } } }),
      "src/index.ts": "export {};\n",
    });
    expect(inspectProjectAliases(project.root).aliases.map((alias) => alias.pattern)).toEqual(["@ts/*"]);
  });

  test("an extends chain contributes inherited paths, nearest config winning", () => {
    const project = fixture({
      "tsconfig.json": tsconfig({ extends: "./tsconfig.base.json", compilerOptions: { paths: { "~/*": ["./src/*"] } } }),
      "tsconfig.base.json": tsconfig({ compilerOptions: { baseUrl: ".", paths: { "@shared/*": ["./src/shared/*"] } } }),
      "src/shared/index.ts": "export {};\n",
    });
    const { aliases, configPaths, baseUrl } = inspectProjectAliases(project.root);
    expect(configPaths).toEqual(["tsconfig.json", "tsconfig.base.json"]);
    // the nearest `paths` declaration wins outright, as TypeScript does
    expect(aliases.map((alias) => alias.pattern)).toEqual(["~/*"]);
    expect(baseUrl?.value).toBe(".");
  });

  test("an extends cycle is stopped and reported rather than followed", () => {
    const project = fixture({
      "tsconfig.json": tsconfig({ extends: "./tsconfig.a.json" }),
      "tsconfig.a.json": tsconfig({ extends: "./tsconfig.b.json", compilerOptions: { paths: { "@a/*": ["./src/*"] } } }),
      "tsconfig.b.json": tsconfig({ extends: "./tsconfig.a.json" }),
      "src/index.ts": "export {};\n",
    });
    const { warnings, aliases } = inspectProjectAliases(project.root);
    expect(warnings.map((warning) => warning.code)).toContain("TSCONFIG_EXTENDS_CYCLE");
    expect(aliases.map((alias) => alias.pattern)).toEqual(["@a/*"]);
    expect(MAX_EXTENDS_DEPTH).toBeGreaterThan(0);
  });

  test("an unresolvable extends target is reported, not silently ignored", () => {
    const project = fixture({
      "tsconfig.json": tsconfig({ extends: "./missing.json", compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "src/index.ts": "export {};\n",
    });
    const { warnings, aliases } = inspectProjectAliases(project.root);
    expect(warnings.map((warning) => warning.code)).toContain("TSCONFIG_EXTENDS_MISSING");
    expect(aliases).toHaveLength(1);
  });

  test("comments and trailing commas in a real tsconfig do not defeat discovery", () => {
    const project = fixture({
      "tsconfig.json": '{\n  // Next.js writes comments here\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@/*": ["./src/*"], },\n  },\n}\n',
      "src/index.ts": "export {};\n",
    });
    expect(inspectProjectAliases(project.root).aliases.map((alias) => alias.pattern)).toEqual(["@/*"]);
  });

  test("a project without any config reports no aliases and no warnings", () => {
    const project = fixture({ "src/index.ts": "export {};\n" });
    const inspection = inspectProjectAliases(project.root);
    expect(inspection.aliases).toEqual([]);
    expect(inspection.warnings).toEqual([]);
    expect(inspection.configPaths).toEqual([]);
  });
});
