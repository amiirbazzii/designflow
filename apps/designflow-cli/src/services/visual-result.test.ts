// apps/designflow-cli/src/services/visual-result.test.ts
import { describe, expect, test } from "bun:test";

import { buildVisualResult, renderVisualResult } from "./visual-result";

const BASE = {
  findingSummaries: [] as string[],
  correctionEligible: false,
  actionableFindingCount: 0,
  previewReady: true,
  captured: true,
  compared: true,
  detailMetrics: [] as string[],
};

describe("Phase 10 visual result model", () => {
  test("a passing comparison renders Looks good without Improve", () => {
    const result = buildVisualResult({ ...BASE, overallStatus: "pass" });
    expect(result.state).toBe("looks_good");
    expect(result.headline).toBe("Looks good");
    expect(result.offerImprove).toBe(false);
  });

  test("actionable findings render Needs improvement with Improve", () => {
    const result = buildVisualResult({
      ...BASE,
      overallStatus: "fail",
      correctionEligible: true,
      actionableFindingCount: 2,
      findingSummaries: ["Main content does not match the selected frame"],
    });
    expect(result.state).toBe("needs_improvement");
    expect(result.offerImprove).toBe(true);
    expect(renderVisualResult(result).join("\n")).toContain("Main content does not match");
  });

  test("non-actionable findings never expose Improve", () => {
    const result = buildVisualResult({
      ...BASE,
      overallStatus: "pass_with_findings",
      correctionEligible: false,
      findingSummaries: ["Minor spacing difference"],
    });
    expect(result.state).toBe("non_actionable");
    expect(result.offerImprove).toBe(false);
    expect(renderVisualResult(result).join("\n")).toContain("none can be corrected automatically");
  });

  test("inconclusive validation never exposes Improve", () => {
    const result = buildVisualResult({ ...BASE, overallStatus: "inconclusive", correctionEligible: true, actionableFindingCount: 1 });
    expect(result.state).toBe("inconclusive");
    expect(result.offerImprove).toBe(false);
  });

  test("infrastructure failure does not pretend the comparison succeeded", () => {
    const result = buildVisualResult({ ...BASE, compared: false, overallStatus: undefined });
    expect(result.state).toBe("failed");
    expect(result.headline).toBe("Visual comparison could not complete");
    expect(result.offerImprove).toBe(false);
    expect(renderVisualResult(result).join("\n")).toContain("applied changes remain in place");
  });

  test("unavailable status is a failed comparison, not a silent pass", () => {
    const result = buildVisualResult({ ...BASE, overallStatus: "unavailable" });
    expect(result.state).toBe("failed");
  });

  test("deterministic reachability evidence is surfaced", () => {
    const result = buildVisualResult({
      ...BASE,
      overallStatus: "fail",
      correctionEligible: true,
      actionableFindingCount: 1,
      unreachableChangedFiles: 1,
    });
    expect(renderVisualResult(result).join("\n")).toContain(
      "not connected to the rendered application",
    );
  });

  test("the normal screen hides internal identifiers; Details stays bounded", () => {
    const result = buildVisualResult({
      ...BASE,
      overallStatus: "fail",
      correctionEligible: true,
      actionableFindingCount: 1,
      referenceLabel: "iPhone 16 Pro Max - 14",
      findingSummaries: ["Navigation differs from the design"],
      detailMetrics: Array.from({ length: 40 }, (_, index) => `metric ${index}`),
    });
    const output = renderVisualResult(result).join("\n").toLowerCase();
    for (const forbidden of ["artifact", "hash", "payload", "node-id", "workflow"]) {
      expect(output).not.toContain(forbidden);
    }
    expect(renderVisualResult(result).join("\n")).toContain("Figma: iPhone 16 Pro Max - 14");
    expect(result.detailLines.length).toBeLessThanOrEqual(20);
  });
});
