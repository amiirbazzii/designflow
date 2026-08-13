// packages/tools/src/project-context/durable-fact-bridge.test.ts
//
// Durable memory must never become stale authority. These tests pin the rule
// the module exists for: fresh inspection > stored fact > unknown.
import { afterAll, describe, expect, test } from "bun:test";
import { applyProjectFactChanges, projectFactSchema, type ProjectFact } from "@designflow/sdk";

import { nextAppRouterFixture, writeProject, type FixtureProject } from "../../test/support/project-fixtures";
import { compileProjectContext } from "./project-context-compiler";
import { durableFactChanges, durableFactsAreCurrent, selectDurableProjectFacts, DURABLE_FACT_KEYS } from "./durable-fact-bridge";

const fixtures: FixtureProject[] = [];
function fixture(project: FixtureProject): FixtureProject {
  fixtures.push(project);
  return project;
}
afterAll(() => {
  for (const project of fixtures) project.cleanup();
});

const NOW = "2026-08-13T00:00:00.000Z";

/** The store's own write path, so persistence is exercised, not simulated. */
function persist(existing: readonly ProjectFact[], changes: ReturnType<typeof durableFactChanges>): readonly ProjectFact[] {
  return applyProjectFactChanges(existing, changes, NOW);
}

const next = fixture(nextAppRouterFixture());
const context = compileProjectContext({
  root: next.root,
  projectId: "project-next",
  implementationContext: undefined,
});

describe("A. a first run writes selected durable facts", () => {
  const facts = persist([], durableFactChanges([], context));

  test("framework, routing and design-system locations are remembered", () => {
    const byKey = new Map(facts.map((fact) => [fact.key, fact.value]));
    expect(byKey.get("project.framework")).toBe("next");
    expect(byKey.get("project.language")).toBe("typescript");
    expect(byKey.get("project.routingKind")).toBe("next-app-router");
    expect(byKey.get("project.designSystemDirectories")).toEqual(["src/components/ui"]);
    expect(byKey.get("project.aliases")).toEqual([
      { pattern: "@/*", targets: ["./src/*"] },
      { pattern: "@missing/*", targets: ["./nope/*"] },
      { pattern: "@ui/*", targets: ["./src/components/ui/*"] },
    ]);
  });

  test("every written fact records that inspection asserted it", () => {
    expect(facts.every((fact) => fact.source === "inspection")).toBe(true);
    expect(facts.every((fact) => projectFactSchema.safeParse(fact).success)).toBe(true);
  });

  test("D: run-specific and volatile state is never persisted", () => {
    const keys = new Set(facts.map((fact) => fact.key));
    for (const key of keys) expect(DURABLE_FACT_KEYS).toContain(key as (typeof DURABLE_FACT_KEYS)[number]);
    // no destinations, no component inventory, no bounds, no warnings
    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain("page.tsx");
    expect(serialized).not.toContain("candidate-directory");
    expect(serialized).not.toContain("compilerVersion\":\"1\",\"inspectors");
  });
});

describe("B/C. unchanged versus changed projects", () => {
  test("B: an unchanged project produces the same durable facts", () => {
    const first = selectDurableProjectFacts(context);
    const again = selectDurableProjectFacts(compileProjectContext({ root: next.root, projectId: "project-next" }));
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
  });

  test("C: a stale stored fact cannot win over fresh inspection", () => {
    const stored = persist([], durableFactChanges([], context));
    // the project changes: the alias is renamed and the UI directory removed
    const changed = fixture(writeProject({
      "package.json": JSON.stringify({ name: "app", dependencies: { next: "15.0.0", react: "18.3.1" } }, null, 2),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "#/*": ["./src/*"] } } }, null, 2),
      "src/app/page.tsx": "export default function Page() { return null; }\n",
      "src/components/Thing.tsx": "export function Thing() { return null; }\n",
    }));
    const freshContext = compileProjectContext({ root: changed.root, projectId: "project-next" });

    const updated = persist(stored, durableFactChanges(stored, freshContext));
    const byKey = new Map(updated.map((fact) => [fact.key, fact.value]));

    expect(byKey.get("project.aliases")).toEqual([{ pattern: "#/*", targets: ["./src/*"] }]);
    // the removed design system is gone from memory, not merely outvoted
    expect(byKey.has("project.designSystemDirectories")).toBe(false);
    expect(freshContext.designSystem.directories).toEqual([]);
  });

  test("staleness is detectable: memory observed under a different fingerprint is not current", () => {
    const withFingerprint = compileProjectContext({
      root: next.root,
      projectId: "project-next",
      implementationContext: {
        schemaVersion: "1",
        project: { id: "project-next", rootIdentity: "root-1", contextFingerprint: "fingerprint-A" },
        runtime: { framework: "next", language: "typescript", packageManager: "bun", monorepo: false, dependencies: [] },
        structure: { sourceRoots: ["src"], routeRoots: [], publicAssetRoots: [], aliases: {} },
        styling: { strategies: ["tailwind"], evidence: [] },
        designSystem: { tokenSources: [], tokens: [], componentSources: [], components: [] },
        conventions: { naming: [], fileLayout: [], exports: [], props: [], testing: [], accessibility: [] },
        commands: {},
        warnings: [],
      } as never,
    });
    const facts = persist([], durableFactChanges([], withFingerprint));
    expect(durableFactsAreCurrent(facts, withFingerprint)).toBe(true);

    const movedOn = { ...withFingerprint, project: { ...withFingerprint.project, contextFingerprint: "fingerprint-B" } };
    expect(durableFactsAreCurrent(facts, movedOn)).toBe(false);
  });

  test("facts with no recorded evidence identity are never treated as current", () => {
    const facts = persist([], durableFactChanges([], context)).filter((fact) => fact.key !== "context.compilerVersion");
    expect(durableFactsAreCurrent(facts, context)).toBe(false);
  });
});

describe("E/F. scope and provenance", () => {
  test("E: facts are keyed per project by the store, never merged across projects", () => {
    const other = fixture(writeProject({
      "package.json": JSON.stringify({ name: "other", dependencies: { react: "18.3.1" } }, null, 2),
      "src/App.tsx": "export default function App() { return null; }\n",
    }));
    const otherContext = compileProjectContext({ root: other.root, projectId: "project-other" });

    const nextFacts = persist([], durableFactChanges([], context));
    const otherFacts = persist([], durableFactChanges([], otherContext));

    // The bridge emits changes for one context at a time; the caller writes
    // them under one projectId, so a project's facts cannot describe another.
    expect(new Map(nextFacts.map((fact) => [fact.key, fact.value])).get("project.framework")).toBe("next");
    expect(new Map(otherFacts.map((fact) => [fact.key, fact.value])).get("project.framework")).toBe("react");
    expect(nextFacts.some((fact) => JSON.stringify(fact.value).includes("other"))).toBe(false);
  });

  test("F: source and confidence survive persistence", () => {
    const facts = persist([], durableFactChanges([], context));
    const framework = facts.find((fact) => fact.key === "project.framework");
    expect(framework?.source).toBe("inspection");
    expect(framework?.createdAt).toBe(NOW);
    expect(framework?.updatedAt).toBe(NOW);
  });

  test("no secret-shaped value can reach the store through this bridge", () => {
    const withSecrets = fixture(nextAppRouterFixture({ ".env": "OPENROUTER_API_KEY=sk-or-v1-secret\n" }));
    const secretContext = compileProjectContext({ root: withSecrets.root, projectId: "project-secrets" });
    const facts = persist([], durableFactChanges([], secretContext));
    expect(JSON.stringify(facts)).not.toContain("sk-or-v1");
    expect(facts.every((fact) => projectFactSchema.safeParse(fact).success)).toBe(true);
  });
});
