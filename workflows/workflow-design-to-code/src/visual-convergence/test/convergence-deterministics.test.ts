// workflows/workflow-design-to-code/src/visual-convergence/test/convergence-deterministics.test.ts
//
// V2-6: the deterministic halves of convergence — policy, comparison,
// selection, repair evidence — proven without any engine or model.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ConvergenceIteration } from "@designflow/sdk";

import { acceptanceStatus, deriveIterationQuality, isActionable } from "../convergence-policy";
import { compareReports, findingKey } from "../finding-comparison";
import { selectBestCandidate } from "../candidate-selection";
import { compileVisualRepairEvidence } from "../repair-evidence";
import { renderConvergenceReport } from "../convergence-report";
import { v2ConvergenceInputSchema } from "../visual-convergence-types";
import { BLUEPRINT, MAP } from "../../v2-visual/test/support/spendly-v2-fixture";
import {
  BUTTON_26PX,
  HEADER_2PX,
  HEADER_8PX,
  MISSING_NAV,
  finding,
  renderedState,
  report,
} from "./support/report-fixtures";

describe("actionable-finding policy: the Builder does not choose what triggers repair", () => {
  test("deterministic critical/major findings trigger; info, ambiguous and zero-confidence do not", () => {
    expect(isActionable(HEADER_8PX)).toBe(true);
    expect(isActionable(MISSING_NAV)).toBe(true);
    expect(isActionable(finding({ findingId: "f", severity: "info" }))).toBe(false);
    expect(isActionable(finding({ findingId: "f", severity: "minor" }))).toBe(false);
    expect(isActionable(finding({ findingId: "f", status: "not-applicable", confidence: 0 }))).toBe(false);
    expect(isActionable(finding({ findingId: "f", confidence: 0 }))).toBe(false);
    expect(isActionable(finding({ findingId: "f", origin: "model-interpreted" }))).toBe(false);
  });

  test("acceptance does not demand zero-delta perfection", () => {
    expect(acceptanceStatus(report([]))).toBe("converged");
    expect(acceptanceStatus(report([finding({ findingId: "f", severity: "minor" })]))).toBe("converged_with_findings");
    expect(acceptanceStatus(report([HEADER_8PX]))).toBe("repair_required");
  });
});

describe("finding comparison uses canonical keys, never prose", () => {
  test("the same requirement improving is recognized as the same finding (§49/§18)", () => {
    // Header +8px → +2px, button unchanged.
    const comparison = compareReports(report([HEADER_8PX, BUTTON_26PX]), report([HEADER_2PX, BUTTON_26PX]));
    expect(comparison.improved).toBe(1);
    expect(comparison.unchanged).toBe(1);
    expect(comparison.verdict).toBe("improved");
    const header = comparison.entries.find((entry) => entry.key === findingKey(HEADER_8PX));
    expect(header?.state).toBe("improved");
    expect(header?.previousDelta).toBe(8);
    expect(header?.currentDelta).toBe(2);
  });

  test("a disappearing finding is resolved, an appearing one is new (§50/§51)", () => {
    const comparison = compareReports(report([HEADER_8PX]), report([MISSING_NAV]));
    expect(comparison.resolved).toBe(1);
    expect(comparison.introduced).toBe(1);
    expect(comparison.verdict).toBe("mixed");
  });

  test("an identical report is no measurable improvement (§48)", () => {
    const comparison = compareReports(report([HEADER_8PX, MISSING_NAV]), report([HEADER_8PX, MISSING_NAV]));
    expect(comparison.verdict).toBe("no_measurable_improvement");
    expect(comparison.unchanged).toBe(2);
  });

  test("pixel mismatch 12% → 18% regresses the verdict (§19)", () => {
    const before = report([], {
      pixelComparisons: [{ viewportId: "desktop", status: "compared", mismatchRatio: 0.12 }],
    });
    const after = report([], {
      pixelComparisons: [{ viewportId: "desktop", status: "compared", mismatchRatio: 0.18 }],
    });
    expect(compareReports(before, after).verdict).toBe("regressed");
  });
});

describe("deterministic best-candidate selection", () => {
  const candidate = (
    iteration: number,
    quality: Partial<ConvergenceIteration["quality"]>,
  ): ConvergenceIteration => ({
    iteration,
    proposalHash: `${iteration}`.repeat(64),
    proposalRef: `proposal-${iteration}`,
    renderedStateRef: `rendered-${iteration}`,
    reportRef: `report-${iteration}`,
    outcome: "needs_refinement",
    quality: {
      renderable: true,
      missingRequiredCount: 0,
      criticalCount: 0,
      majorCount: 0,
      unresolvedExpectationCount: 0,
      actionableCount: 0,
      ...quality,
    },
    builderAttempts: 1,
  });

  test("a regressing last iteration loses to a stronger earlier one (§47)", () => {
    const selected = selectBestCandidate([
      candidate(0, { majorCount: 4, actionableCount: 4 }),
      candidate(1, { majorCount: 1, actionableCount: 1 }),
      candidate(2, { missingRequiredCount: 1, actionableCount: 1 }),
    ]);
    expect(selected?.iteration).toBe(1);
  });

  test("later iteration wins only as the final tie-breaker", () => {
    expect(selectBestCandidate([candidate(0, {}), candidate(1, {}), candidate(2, {})])?.iteration).toBe(2);
  });

  test("non-renderable states are never candidates, and no candidate is an honest undefined", () => {
    expect(
      selectBestCandidate([candidate(1, { renderable: false }), candidate(2, { renderable: false })]),
    ).toBeUndefined();
    const selected = selectBestCandidate([candidate(0, {}), candidate(1, { renderable: false, majorCount: 0 })]);
    expect(selected?.iteration).toBe(0);
  });

  test("missing required elements outrank every later criterion", () => {
    const selected = selectBestCandidate([
      candidate(0, { majorCount: 5, actionableCount: 5 }),
      candidate(1, { missingRequiredCount: 1, actionableCount: 1, pixelMismatchRatio: 0 }),
    ]);
    expect(selected?.iteration).toBe(0);
  });
});

describe("repair evidence is finding-scoped and map-bounded", () => {
  test("each finding maps to the plan's own implementation target (§6)", () => {
    const evidence = compileVisualRepairEvidence({ report: report([HEADER_8PX, MISSING_NAV]), map: MAP, blueprint: BLUEPRINT });

    // Header is an inline element of the screen → the screen's own file.
    const header = evidence.findings.find((entry) => entry.label === "Header");
    expect(header?.targetPaths).toEqual(["src/App.jsx"]);
    expect(header?.property).toBe("height");
    expect(header?.delta).toBe(8);
    // BottomNavigation is a mapped create → its planned path.
    const nav = evidence.findings.find((entry) => entry.label === "BottomNavigation");
    expect(nav?.targetPaths).toContain("src/BottomNavigation.jsx");
    expect(evidence.planIsImmutable).toBe(true);
    expect(evidence.allowedTargets).toEqual(["src/App.jsx", "src/BottomNavigation.jsx"]);
  });

  test("an unmappable finding is carried as unresolved, without instructions", () => {
    const stray = finding({ findingId: "finding:expectation:9:9:height", evidenceReferences: ["9:9", "viewport:desktop"] });
    const evidence = compileVisualRepairEvidence({ report: report([stray]), map: MAP, blueprint: BLUEPRINT });
    expect(evidence.findings).toHaveLength(0);
    expect(evidence.unresolved[0]?.blueprintRef).toBe("9:9");
  });

  test("ambiguous correspondence never becomes a precise instruction (§52)", () => {
    const evidence = compileVisualRepairEvidence({
      report: report([]),
      map: MAP,
      blueprint: BLUEPRINT,
      correspondences: [
        { blueprintRef: "1:3", state: "ambiguous", signals: ["content"], confidence: 0, candidateCount: 2 },
      ],
    });
    expect(evidence.findings).toHaveLength(0);
    expect(evidence.unresolved[0]?.reason).toContain("correspondence unresolved");
    expect(JSON.stringify(evidence)).not.toContain("px");
  });

  test("Critic guidance arrives separated as advisory, never as a measurement", () => {
    const annotated = report([HEADER_8PX], {
      annotations: [{ findingId: HEADER_8PX.findingId, repairGuidance: "Reduce the header block height." }],
      critic: { status: "completed", partitionCount: 1, patchCount: 1, summaries: [] },
    });
    const evidence = compileVisualRepairEvidence({ report: annotated, map: MAP, blueprint: BLUEPRINT });
    expect(evidence.advisory).toEqual([
      { findingId: HEADER_8PX.findingId, guidance: "Reduce the header block height." },
    ]);
    // Measured facts live in findings; advisory carries no expected/actual.
    expect(Object.keys(evidence.advisory[0]!)).toEqual(["findingId", "guidance"]);
  });
});

describe("the bound cannot be exceeded", () => {
  test("the input schema refuses more than the hard maximum of 3 evaluated states", () => {
    const base = { project: { id: "p", name: "P", rootPath: "/tmp/p" } };
    expect(v2ConvergenceInputSchema.shape.maxEvaluatedStates.safeParse(4).success).toBe(false);
    expect(v2ConvergenceInputSchema.shape.maxEvaluatedStates.safeParse(3).success).toBe(true);
    void base;
  });
});

describe("quality derivation and the human-readable projection", () => {
  test("unresolved expectations come from correspondence, not from prose", () => {
    const quality = deriveIterationQuality(report([HEADER_8PX, MISSING_NAV]), renderedState());
    expect(quality.missingRequiredCount).toBe(1);
    expect(quality.majorCount).toBe(2);
    expect(quality.unresolvedExpectationCount).toBe(2);
    expect(quality.renderable).toBe(true);
  });

  test("a regressing final iteration is explained, and the report is not truth", () => {
    const text = renderConvergenceReport({
      schemaVersion: "1",
      status: "exhausted",
      stopReason: "regression_detected",
      iterationLimit: 3,
      iterationsPerformed: 3,
      iterations: [0, 1, 2].map((iteration) => ({
        iteration,
        proposalHash: `${iteration}`.repeat(64),
        proposalRef: `proposal-${iteration}`,
        renderedStateRef: `rendered-${iteration}`,
        reportRef: `report-${iteration}`,
        outcome: "needs_refinement",
        quality: {
          renderable: true,
          missingRequiredCount: iteration === 2 ? 1 : 0,
          criticalCount: 0,
          majorCount: iteration === 0 ? 4 : 1,
          unresolvedExpectationCount: 0,
          actionableCount: iteration === 0 ? 4 : 1,
        },
        builderAttempts: 1,
      })),
      selectedIteration: 1,
      selectionPolicyVersion: "1",
      metrics: {
        visualConvergenceIterationCount: 3,
        visualConvergenceRepairCount: 2,
        visualConvergenceInitialFindingCount: 4,
        visualConvergenceFinalFindingCount: 1,
        visualConvergenceResolvedCount: 3,
        visualConvergenceImprovedCount: 0,
        visualConvergenceRegressedCount: 1,
        visualConvergenceSelectedIteration: 1,
        visualConvergenceStopReason: "regression_detected",
      },
      notes: [],
    });
    expect(text).toContain("Selected implementation");
    expect(text).toContain("Iteration 2");
    expect(text).toContain("Iteration 3 was not selected");
    expect(text).toContain("regressed overall quality");
  });
});

describe("the legacy Visual Correction agent is not part of this loop (§43)", () => {
  test("no convergence source references the legacy correction module", () => {
    const feature = join(import.meta.dir, "..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          if (entry !== "test") walk(path);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
        if (readFileSync(path, "utf8").includes("visual-correction")) offenders.push(entry);
      }
    };
    walk(feature);
    expect(offenders).toEqual([]);
  });
});
