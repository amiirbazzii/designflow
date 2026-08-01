// packages/tools/src/catalog/classify-product-request.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { classifyProductRequestTool } from "./classify-product-request";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("classify-product-request", () => {
  test("recognises each kind of ask", async () => {
    expect(
      (await classifyProductRequestTool.execute({ request: "build a new export feature" }, ctx())).requestType,
    ).toBe("new_feature");
    expect(
      (await classifyProductRequestTool.execute({ request: "improve the checkout speed" }, ctx())).requestType,
    ).toBe("improvement");
    expect(
      (await classifyProductRequestTool.execute({ request: "research competitor pricing options" }, ctx()))
        .requestType,
    ).toBe("research");
  });

  test("unrecognised requests are unknown with zero confidence", async () => {
    const result = await classifyProductRequestTool.execute({ request: "hello" }, ctx());
    expect(result).toEqual({ requestType: "unknown", confidence: 0, signals: [] });
  });

  test("rejects unknown input fields", () => {
    expect(() => classifyProductRequestTool.inputSchema.parse({ request: "x", nope: 1 })).toThrow();
  });
});
