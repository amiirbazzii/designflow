// packages/tools/src/catalog/extract-structured-claims.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { extractStructuredClaimsTool } from "./extract-structured-claims";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("extract-structured-claims", () => {
  test("keeps assertive sentences and tags them with the source id", async () => {
    const result = await extractStructuredClaimsTool.execute(
      {
        sourceId: "src-1",
        text: "The study shows that adoption increased significantly. What does this mean for us? The team confirms the results are reproducible.",
      },
      ctx(),
    );

    expect(result.sourceId).toBe("src-1");
    expect(result.claimCount).toBe(2);
    expect(result.claims.every((claim) => claim.sourceId === "src-1")).toBe(true);
    expect(result.claims[0]?.text).toContain("shows that adoption increased");
    expect(result.claims[1]?.text).toContain("confirms the results");
  });

  test("drops questions and short fragments", async () => {
    const result = await extractStructuredClaimsTool.execute(
      { sourceId: "src-2", text: "Is this correct? Yes." },
      ctx(),
    );

    expect(result.claims).toEqual([]);
    expect(result.claimCount).toBe(0);
  });

  test("is deterministic across calls", async () => {
    const input = { sourceId: "src-3", text: "Researchers found a strong correlation between the two variables." };
    const first = await extractStructuredClaimsTool.execute(input, ctx());
    const second = await extractStructuredClaimsTool.execute(input, ctx());

    expect(first).toEqual(second);
  });
});
