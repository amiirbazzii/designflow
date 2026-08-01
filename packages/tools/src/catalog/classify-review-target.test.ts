// packages/tools/src/catalog/classify-review-target.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { classifyReviewTargetTool } from "./classify-review-target";

describe("classify-review-target", () => {
  test("recognises each scope", async () => {
    expect((await classifyReviewTargetTool.execute({ request: "review this button component" }, ctx())).reviewType).toBe(
      "component",
    );
    expect((await classifyReviewTargetTool.execute({ request: "review the checkout flow" }, ctx())).reviewType).toBe(
      "page",
    );
    expect(
      (await classifyReviewTargetTool.execute({ request: "review the entire app before launch" }, ctx())).reviewType,
    ).toBe("full_app");
  });

  test("a large item count reads as a full-app review even without matching words", async () => {
    const result = await classifyReviewTargetTool.execute(
      { request: "review these changes", itemCount: 42 },
      ctx(),
    );

    expect(result.reviewType).toBe("full_app");
    expect(result.signals).toContain("large_item_count");
  });

  test("unrecognised requests are unknown with zero confidence", async () => {
    const result = await classifyReviewTargetTool.execute({ request: "hello there" }, ctx());
    expect(result).toEqual({ reviewType: "unknown", confidence: 0, signals: [] });
  });

  test("rejects input outside the schema", () => {
    expect(() => classifyReviewTargetTool.inputSchema.parse({ request: "x", extra: true })).toThrow();
  });
});

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}
