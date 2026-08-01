// packages/tools/src/catalog/summarize-artifact-set.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { summarizeArtifactSetTool } from "./summarize-artifact-set";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("summarize-artifact-set", () => {
  test("counts items by kind and orders the summary by count then name", async () => {
    const result = await summarizeArtifactSetTool.execute(
      {
        items: [
          { path: "a.tsx", kind: "component" },
          { path: "b.tsx", kind: "component" },
          { path: "c.test.tsx", kind: "test" },
          { path: "d.tsx", kind: "page" },
          { path: "e.tsx", kind: "component" },
        ],
      },
      ctx(),
    );

    expect(result.totalCount).toBe(5);
    expect(result.countsByKind).toEqual({ component: 3, test: 1, page: 1 });
    expect(result.summary).toBe("5 artifacts across 3 kinds: component (3), page (1), test (1).");
  });

  test("an empty set summarizes without dividing by zero", async () => {
    const result = await summarizeArtifactSetTool.execute({ items: [] }, ctx());

    expect(result).toEqual({ totalCount: 0, countsByKind: {}, summary: "No artifacts." });
  });

  test("is deterministic across calls", async () => {
    const items = [{ path: "a.tsx", kind: "component" }];
    const first = await summarizeArtifactSetTool.execute({ items }, ctx());
    const second = await summarizeArtifactSetTool.execute({ items }, ctx());

    expect(first).toEqual(second);
  });
});
