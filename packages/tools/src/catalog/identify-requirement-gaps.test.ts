// packages/tools/src/catalog/identify-requirement-gaps.test.ts
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@designflow/sdk";
import { identifyRequirementGapsTool } from "./identify-requirement-gaps";

function ctx(): ToolContext {
  return {
    signal: new AbortController().signal,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    metadata: {},
  };
}

describe("identify-requirement-gaps", () => {
  test("flags missing priority and missing acceptance criteria", async () => {
    const result = await identifyRequirementGapsTool.execute(
      {
        requirements: [
          { id: "r1", text: "Users can export their data as CSV", priority: "high", acceptanceCriteria: "Given..." },
          { id: "r2", text: "Users can import a spreadsheet of contacts" },
        ],
      },
      ctx(),
    );

    const r1 = result.gaps.find((g) => g.id === "r1");
    const r2 = result.gaps.find((g) => g.id === "r2");

    expect(r1?.missingPriority).toBe(false);
    expect(r1?.missingAcceptanceCriteria).toBe(false);
    expect(r2?.missingPriority).toBe(true);
    expect(r2?.missingAcceptanceCriteria).toBe(true);
  });

  test("flags near-identical wording as a possible duplicate", async () => {
    const result = await identifyRequirementGapsTool.execute(
      {
        requirements: [
          { id: "r1", text: "Users should be able to reset their forgotten password by email" },
          { id: "r2", text: "Users should be able to reset their forgotten password via email" },
          { id: "r3", text: "Admins can export the billing report as a PDF" },
        ],
      },
      ctx(),
    );

    const r1 = result.gaps.find((g) => g.id === "r1");
    const r3 = result.gaps.find((g) => g.id === "r3");

    expect(r1?.possibleDuplicateOf).toContain("r2");
    expect(r3?.possibleDuplicateOf).toEqual([]);
  });

  test("counts a gap once per requirement per gap type", async () => {
    const result = await identifyRequirementGapsTool.execute(
      { requirements: [{ id: "r1", text: "Something with no metadata at all here" }] },
      ctx(),
    );

    expect(result.gapCount).toBe(2);
  });
});
