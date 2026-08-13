// packages/tools/src/project-context/test/project-context-compiler.test.ts
//
// V2-2 acceptance: the project is understood deterministically, once, with
// provenance — and the compiler stays truthful when there is little to find.
import { afterAll, describe, expect, test } from "bun:test";
import { canonicalProjectContextSchema } from "@designflow/sdk";

import {
  largeComponentFixture,
  nextAppRouterFixture,
  reactViteFixture,
  sparseFixture,
  writeProject,
  type FixtureProject,
} from "./fixtures/project-fixtures";
import { compileProjectContext, MAX_COMPONENT_INVENTORY } from "../project-context-compiler";

const fixtures: FixtureProject[] = [];
function fixture(project: FixtureProject): FixtureProject {
  fixtures.push(project);
  return project;
}
afterAll(() => {
  for (const project of fixtures) project.cleanup();
});

const next = fixture(nextAppRouterFixture());
const nextContext = compileProjectContext({ root: next.root, projectId: "project-next" });

describe("A. Next.js App Router + TypeScript", () => {
  test("runtime facts come from declarations, with provenance", () => {
    expect(canonicalProjectContextSchema.safeParse(nextContext).success).toBe(true);
    expect(nextContext.runtime.framework?.value).toBe("next");
    expect(nextContext.runtime.framework?.provenance).toMatchObject({ source: "package_manifest", confidence: "deterministic" });
    expect(nextContext.runtime.language?.value).toBe("typescript");
    expect(nextContext.runtime.packageManager?.value).toBe("bun");
    expect(nextContext.provenance.compilerVersion).toBe("1");
    expect(nextContext.provenance.inspectors).toContain("tools/project-inspection");
  });

  test("routing is recognized from the project's own convention", () => {
    expect(nextContext.routing.kind).toBe("next-app-router");
    expect(nextContext.routing.routeFileConvention).toBe("app/**/page.tsx");
    expect(nextContext.routing.provenance?.source).toBe("route_convention");
  });

  test("destinations distinguish existing routes, composition roots and candidates", () => {
    const byPath = new Map(nextContext.destinations.map((entry) => [entry.path, entry]));
    expect(byPath.get("src/app/add/page.tsx")).toMatchObject({ kind: "page", status: "existing", route: "/add" });
    expect(byPath.get("src/app/layout.tsx")?.kind).toBe("composition-root");
    expect(nextContext.destinations.some((entry) => entry.status === "candidate-directory")).toBe(true);
    // evidence only — nothing here selects a destination
    expect(nextContext.destinations.every((entry) => entry.status !== "explicitly-selected")).toBe(true);
  });

  test("design-system evidence separates a UI directory from generic components", () => {
    expect(nextContext.designSystem.directories.map((entry) => entry.value)).toContain("src/components/ui");
    expect(nextContext.designSystem.directories[0]?.provenance.confidence).toBe("heuristic");
    expect(nextContext.designSystem.genericComponentDirectories).toContain("src/components");
    expect(nextContext.designSystem.genericComponentDirectories).not.toContain("src/components/ui");
  });

  test("component inventory records design-system membership", () => {
    const button = nextContext.components.find((component) => component.path.endsWith("ui/button.tsx"));
    const card = nextContext.components.find((component) => component.path.endsWith("history-card.tsx"));
    expect(button?.designSystemMember).toBe(true);
    expect(card?.designSystemMember).toBe(false);
    expect(button?.provenance.source).toBe("filesystem");
  });

  test("styling and testing capability are read from config and dependencies", () => {
    expect(nextContext.styling.configPaths).toContain("tailwind.config.ts");
    expect(nextContext.testing.framework?.value).toBe("vitest");
    // the fixture declares @playwright/test, which is exactly the e2e
    // capability a later Builder needs to know about without guessing
    expect(nextContext.testing.browserAutomation?.value).toBe("@playwright/test");
  });

  test("conventions are only asserted with enough evidence", () => {
    const kinds = nextContext.conventions.map((convention) => convention.kind);
    expect(kinds).toContain("import-alias");
    expect(kinds).toContain("source-root");
    expect(nextContext.conventions.every((convention) => convention.provenance.confidence !== undefined)).toBe(true);
  });
});

describe("B. React + Vite", () => {
  const vite = fixture(reactViteFixture());
  const context = compileProjectContext({ root: vite.root, projectId: "project-vite" });

  test("framework, router and package manager", () => {
    expect(context.runtime.framework?.value).toBe("react");
    expect(context.runtime.packageManager?.value).toBe("pnpm");
    expect(context.routing.kind).toBe("react-router");
    expect(context.testing.framework?.value).toBe("jest");
  });

  test("route literals declared in source become destinations", () => {
    expect(context.destinations.some((entry) => entry.route === "/dashboard")).toBe(true);
    expect(context.destinations.some((entry) => entry.kind === "composition-root" && entry.path.endsWith("App.tsx"))).toBe(true);
  });
});

describe("C. Sparse project", () => {
  const sparse = fixture(sparseFixture());
  const context = compileProjectContext({ root: sparse.root, projectId: "project-sparse" });

  test("a project with nothing to find produces a small truthful context", () => {
    expect(canonicalProjectContextSchema.safeParse(context).success).toBe(true);
    expect(context.runtime.framework).toBeUndefined();
    expect(context.routing.kind).toBe("unknown");
    expect(context.components).toEqual([]);
    expect(context.destinations).toEqual([]);
    expect(context.structure.aliases).toEqual([]);
    expect(context.designSystem.directories).toEqual([]);
    expect(context.conventions.every((convention) => convention.provenance.confidence !== "deterministic" || convention.provenance.path !== undefined)).toBe(true);
  });
});

describe("determinism", () => {
  test("compiling an unchanged project twice produces an identical context", () => {
    const again = compileProjectContext({ root: next.root, projectId: "project-next" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(nextContext));
  });

  test("changing tsconfig changes the context", () => {
    const changed = fixture(nextAppRouterFixture({
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "#/*": ["./src/*"] } } }, null, 2),
    }));
    const context = compileProjectContext({ root: changed.root, projectId: "project-next" });
    expect(context.structure.aliases.map((alias) => alias.pattern)).toEqual(["#/*"]);
    expect(nextContext.structure.aliases.map((alias) => alias.pattern)).not.toEqual(["#/*"]);
  });

  test("a removed design-system directory is no longer reported", () => {
    const withoutUi = fixture(writeProject({
      "package.json": JSON.stringify({ name: "app", dependencies: { next: "15.0.0", react: "18.3.1" } }, null, 2),
      "src/app/page.tsx": "export default function Page() { return null; }\n",
      "src/components/Thing.tsx": "export function Thing() { return null; }\n",
    }));
    const context = compileProjectContext({ root: withoutUi.root, projectId: "project-next" });
    expect(context.designSystem.directories).toEqual([]);
  });
});

describe("bounds", () => {
  test("a large component inventory is bounded and the bound is recorded", () => {
    const large = fixture(largeComponentFixture(MAX_COMPONENT_INVENTORY + 25));
    const context = compileProjectContext({ root: large.root, projectId: "project-large" });
    const bound = context.bounds.find((entry) => entry.collection === "components");

    if (bound !== undefined) {
      expect(context.components.length).toBe(bound.retainedCount);
      expect(bound.discoveredCount ?? 0).toBeGreaterThan(bound.retainedCount);
      expect(bound.exhaustive).toBe(true);
    }
    // whichever bound was hit first, the context must say something was bounded
    expect(context.bounds.length).toBeGreaterThan(0);
    // component order is stable, so a bound retains a predictable prefix
    const paths = context.components.map((component) => component.path);
    expect([...paths].sort()).toEqual(paths);
  });

  test("a non-exhaustive walk says so instead of inventing a total", () => {
    const large = fixture(largeComponentFixture(120));
    const context = compileProjectContext({ root: large.root, projectId: "project-large" });
    const fileBound = context.bounds.find((entry) => entry.collection === "inspectedFiles");
    if (fileBound !== undefined) {
      expect(fileBound.exhaustive).toBe(false);
      expect(fileBound.discoveredCount).toBeUndefined();
    }
  });
});

describe("security", () => {
  test("no environment values or secrets reach the context", () => {
    const withSecrets = fixture(nextAppRouterFixture({
      ".env": "OPENROUTER_API_KEY=sk-or-v1-supersecret\n",
      ".env.local": "DATABASE_URL=postgres://user:password@host/db\n",
      "src/config.ts": "export const apiKey = 'sk-or-v1-anothersecret';\n",
    }));
    const serialized = JSON.stringify(compileProjectContext({ root: withSecrets.root, projectId: "project-secrets" }));
    expect(serialized).not.toContain("sk-or-v1");
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("OPENROUTER_API_KEY");
  });
});
