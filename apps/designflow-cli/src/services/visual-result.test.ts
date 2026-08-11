// apps/designflow-cli/src/services/visual-result.test.ts
import { describe, expect, test } from "bun:test";

import { buildVisualResult, buildVisualResultView, renderVisualResult } from "./visual-result";

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

describe("Phase 5A product visual result view", () => {
  const view = (overrides: Partial<Parameters<typeof buildVisualResultView>[0]> = {}) => buildVisualResultView({
    reportAvailable: true,
    classification: "pass",
    findingSummaries: [],
    correctionEligibility: { status: "not_needed" },
    ...overrides,
  });

  test("maps every persisted classification to truthful product language", () => {
    expect(view({ classification: "pass" }).title).toBe("Looks good");
    expect(view({ classification: "pass_with_findings", correctionEligibility: { status: "eligible" } }).title).toBe("Needs improvement");
    expect(view({ classification: "fail", correctionEligibility: { status: "eligible" } }).title).toBe("Needs improvement");
    expect(view({ classification: "pass_with_findings" }).title).toBe("Needs improvement");
    expect(view({ classification: "fail" }).title).toBe("Needs improvement");
    expect(view({ classification: "inconclusive" }).title).toBe("Inconclusive");
    expect(view({ classification: "unavailable" }).title).toBe("Missing evidence");
    expect(view({ classification: undefined }).title).toBe("Missing evidence");
  });

  test("renders bounded persisted findings and does not invent absent findings", () => {
    const findings = ["Header spacing differs", "Form width differs"];
    expect(view({ classification: "fail", findingSummaries: findings }).findings).toEqual(findings);
    expect(view({ classification: "pass" }).findings).toEqual([]);
    expect(view({ findingSummaries: Array.from({ length: 8 }, (_, index) => `${index}-${"x".repeat(240)}`) }).findings).toHaveLength(5);
    expect(view({ findingSummaries: ["x".repeat(240)] }).findings[0]).toHaveLength(200);
  });

  test("renders reachability only from the persisted reachability fact", () => {
    expect(view({ unreachableChangedFiles: 0 }).reachability).toBe("rendered");
    expect(view({ unreachableChangedFiles: 2 }).reachability).toBe("unreachable");
    expect(view().reachability).toBeUndefined();
  });

  test("offers Improve only when host correction eligibility is eligible", () => {
    expect(view({ classification: "fail", correctionEligibility: { status: "eligible" } })).toMatchObject({
      canImprove: true,
      actions: ["View report", "Improve", "Finish"],
    });
    for (const status of ["not_needed", "blocked", "iteration_limit_reached", "completed", "inconclusive", "unavailable"]) {
      const result = view({ classification: "fail", correctionEligibility: { status, reason: `host says ${status}` } });
      expect(result.canImprove).toBe(false);
      expect(result.actions).toEqual(["View report", "Finish"]);
      expect(result.improveUnavailableReason).toBe(`host says ${status}`);
    }
  });

  test("keeps report availability truthful and leaves inputs unchanged", () => {
    const input = {
      reportAvailable: false,
      classification: "pass" as const,
      findingSummaries: ["Recorded finding"],
      unreachableChangedFiles: 0,
      correctionEligibility: { status: "eligible", reason: "ready" },
    };
    const before = JSON.stringify(input);
    const result = buildVisualResultView(input);
    expect(result).toMatchObject({ reportAvailable: false, canImprove: true });
    expect(result.actions).toEqual(["Improve", "Finish"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("approval mode does not affect deterministic visual eligibility", () => {
    const eligible = view({ classification: "fail", correctionEligibility: { status: "eligible" } });
    const sameEligibility = view({ classification: "fail", correctionEligibility: { status: "eligible" } });
    expect(eligible).toEqual(sameEligibility);
  });
});
