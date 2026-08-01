// packages/tools/src/catalog/accessibility-checklist.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { accessibilityChecklistTool } from "./accessibility-checklist";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("accessibility-checklist", () => {
  test("always returns the same four fixed categories", async () => {
    const result = await accessibilityChecklistTool.execute({ request: "add a button" }, ctx());
    expect(result.checklist.map((entry) => entry.category)).toEqual([
      "aria",
      "contrast",
      "keyboard",
      "semantics",
    ]);
  });

  test("flags mentioned categories from keywords and scores coverage", async () => {
    const result = await accessibilityChecklistTool.execute(
      { request: "make sure focus order and aria-label are correct, and check color contrast" },
      ctx(),
    );

    const byCategory = Object.fromEntries(result.checklist.map((entry) => [entry.category, entry]));
    expect(byCategory.keyboard?.status).toBe("mentioned");
    expect(byCategory.aria?.status).toBe("mentioned");
    expect(byCategory.contrast?.status).toBe("mentioned");
    expect(byCategory.semantics?.status).toBe("not_mentioned");
    expect(result.coverageScore).toBe(0.75);
  });

  test("a request mentioning nothing scores zero coverage", async () => {
    const result = await accessibilityChecklistTool.execute({ request: "build a new landing page" }, ctx());
    expect(result.coverageScore).toBe(0);
    expect(result.checklist.every((entry) => entry.status === "not_mentioned")).toBe(true);
  });

  test("extra items are scanned alongside the request", async () => {
    const result = await accessibilityChecklistTool.execute(
      { request: "build a new page", items: ["use semantic html headings"] },
      ctx(),
    );

    const semantics = result.checklist.find((entry) => entry.category === "semantics");
    expect(semantics?.status).toBe("mentioned");
  });
});
