// packages/tools/src/catalog/structure-acceptance-criteria.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { structureAcceptanceCriteriaTool } from "./structure-acceptance-criteria";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("structure-acceptance-criteria", () => {
  test("splits a when/then style requirement into Given/When/Then", async () => {
    const result = await structureAcceptanceCriteriaTool.execute(
      {
        requirementId: "req-1",
        text: "Given a signed-in user, when they click export, then a CSV file should download",
      },
      ctx(),
    );

    expect(result.format).toBe("given_when_then");
    expect(result.criteria[0]).toMatch(/^Given a signed-in user/);
    expect(result.criteria[1]).toMatch(/^When they click export/);
    expect(result.criteria[2]).toMatch(/^Then/);
  });

  test("falls back to a checklist when there is no when/then structure", async () => {
    const result = await structureAcceptanceCriteriaTool.execute(
      { requirementId: "req-2", text: "Support CSV export. Support JSON export." },
      ctx(),
    );

    expect(result.format).toBe("checklist");
    expect(result.criteria).toEqual(["- Support CSV export", "- Support JSON export"]);
  });

  test("is deterministic across calls", async () => {
    const input = { requirementId: "req-3", text: "When the user submits the form, it must validate all fields" };
    const first = await structureAcceptanceCriteriaTool.execute(input, ctx());
    const second = await structureAcceptanceCriteriaTool.execute(input, ctx());

    expect(first).toEqual(second);
  });
});
