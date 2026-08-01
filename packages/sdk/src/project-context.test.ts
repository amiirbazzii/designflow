// packages/sdk/src/project-context.test.ts
import { describe, expect, test } from "bun:test";
import { applyProjectFactChanges, projectContextSchema, projectFactSchema } from "./project-context";

const NOW = "2026-08-01T00:00:00.000Z";

function fact(overrides: Partial<Parameters<typeof projectFactSchema.parse>[0]> = {}) {
  return {
    key: "project.framework",
    value: "react",
    source: "inspection" as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("projectFactSchema", () => {
  test("accepts a well-formed explicit fact", () => {
    expect(() => projectFactSchema.parse(fact())).not.toThrow();
  });

  test("rejects a non-dotted-identifier key", () => {
    expect(() => projectFactSchema.parse(fact({ key: "not a key!" }))).toThrow();
  });

  test("rejects an inferred fact with no confidence", () => {
    expect(() => projectFactSchema.parse(fact({ source: "inferred" }))).toThrow();
  });

  test("accepts an inferred fact with confidence", () => {
    expect(() =>
      projectFactSchema.parse(fact({ source: "inferred", confidence: 0.6 })),
    ).not.toThrow();
  });

  test("rejects a secret-like value", () => {
    expect(() =>
      projectFactSchema.parse(fact({ key: "project.credential", value: "sk-abcdefghijk12345" })),
    ).toThrow();
  });

  test("rejects an oversized value", () => {
    expect(() => projectFactSchema.parse(fact({ value: "x".repeat(5_000) }))).toThrow();
  });

  test("rejects unknown keys (strict)", () => {
    expect(() => projectFactSchema.parse({ ...fact(), extra: true })).toThrow();
  });
});

describe("projectContextSchema", () => {
  test("rejects duplicate fact keys", () => {
    expect(() =>
      projectContextSchema.parse({
        projectId: "proj-1",
        version: 1,
        updatedAt: NOW,
        facts: [fact(), fact()],
      }),
    ).toThrow();
  });
});

describe("applyProjectFactChanges", () => {
  test("upsert replaces a same-keyed fact and preserves createdAt", () => {
    const existing = [projectFactSchema.parse(fact({ createdAt: "2026-01-01T00:00:00.000Z" }))];

    const updated = applyProjectFactChanges(
      existing,
      [{ op: "upsert", fact: { key: "project.framework", value: "vue", source: "user" } }],
      NOW,
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]?.value).toBe("vue");
    expect(updated[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updated[0]?.updatedAt).toBe(NOW);
  });

  test("remove drops the fact", () => {
    const existing = [projectFactSchema.parse(fact())];
    const updated = applyProjectFactChanges(existing, [{ op: "remove", key: "project.framework" }], NOW);
    expect(updated).toHaveLength(0);
  });

  test("deterministic ordering by key", () => {
    const updated = applyProjectFactChanges(
      [],
      [
        { op: "upsert", fact: { key: "project.sourceRoot", value: "src", source: "inspection" } },
        { op: "upsert", fact: { key: "designSystem.path", value: "src/ui", source: "inferred", confidence: 0.5 } },
      ],
      NOW,
    );

    expect(updated.map((f) => f.key)).toEqual(["designSystem.path", "project.sourceRoot"]);
  });
});
