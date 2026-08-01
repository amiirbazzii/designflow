// packages/tools/src/catalog/classify-research-request.test.ts
import { describe, expect, test } from "bun:test";
import { classifyResearchRequestTool } from "./classify-research-request";
import type { ToolContext } from "@designflow/sdk";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("classify-research-request", () => {
  test("recognises each depth", async () => {
    expect((await classifyResearchRequestTool.execute({ request: "give me a quick summary" }, ctx())).depth).toBe(
      "quick",
    );
    expect(
      (await classifyResearchRequestTool.execute({ request: "research competitor pricing" }, ctx())).depth,
    ).toBe("standard");
    expect(
      (await classifyResearchRequestTool.execute({ request: "do a comprehensive deep dive on this" }, ctx()))
        .depth,
    ).toBe("deep");
  });

  test("unrecognised requests are unknown with zero confidence", async () => {
    const result = await classifyResearchRequestTool.execute({ request: "good morning" }, ctx());
    expect(result).toEqual({ depth: "unknown", confidence: 0, signals: [] });
  });

  test("rejects an empty request", () => {
    expect(() => classifyResearchRequestTool.inputSchema.parse({ request: "" })).toThrow();
  });
});
