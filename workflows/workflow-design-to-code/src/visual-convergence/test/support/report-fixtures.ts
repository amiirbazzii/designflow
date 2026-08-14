// workflows/workflow-design-to-code/src/visual-convergence/test/support/report-fixtures.ts
//
// Hand-built reports and findings for the deterministic convergence modules.
import type { RenderedState, VisualDeltaReport, VisualFindingV1 } from "@designflow/sdk";

export function finding(overrides: Partial<VisualFindingV1> & { findingId: string }): VisualFindingV1 {
  return {
    schemaVersion: "1",
    category: "size",
    severity: "major",
    confidence: 0.95,
    status: "confirmed",
    explanation: "measured mismatch",
    evidenceReferences: ["1:2", "viewport:desktop"],
    origin: "deterministic",
    ...overrides,
  };
}

export function report(
  findings: readonly VisualFindingV1[],
  overrides: Partial<VisualDeltaReport> = {},
): VisualDeltaReport {
  return {
    schemaVersion: "1",
    outcome: findings.some((entry) => entry.severity === "major" || entry.severity === "critical")
      ? "needs_refinement"
      : "pass",
    binding: { proposalHash: "a".repeat(64) },
    findings: [...findings],
    annotations: [],
    expectationCount: 8,
    correspondence: { matched: 6, ambiguous: 0, unmatched: 2, signalsUsed: ["content"] },
    pixelComparisons: [],
    critic: { status: "not_requested", partitionCount: 0, patchCount: 0, summaries: [] },
    passFailPolicy: {
      criticalDeterministicFails: true,
      majorDeterministicNeedsRefinement: true,
      missingRequiredElementFails: true,
      renderFailureIsFailure: true,
      browserUnavailableIsInconclusive: true,
      criticSeverityMayEscalate: false,
    },
    ...overrides,
  };
}

export function renderedState(status: RenderedState["status"] = "rendered"): RenderedState {
  return {
    schemaVersion: "1",
    status,
    binding: { proposalHash: "a".repeat(64) },
    viewports: [],
    elements: [],
    pixelComparisons: [],
    correspondences: [],
    runtime: { buildStatus: "passed", previewStatus: "ready", diagnostics: [] },
    provenance: {
      rendererVersion: "1.0.0",
      workspaceIsolated: true,
      renderInstrumentationApplied: false,
      instrumentedFileCount: 0,
      instrumentationNotes: [],
    },
  };
}

export const HEADER_8PX = finding({
  findingId: "finding:expectation:1:2:height",
  affectedComponent: "Header",
  expectedValue: "64px",
  actualValue: "72px",
  measurableDelta: 8,
});

export const HEADER_2PX = finding({
  findingId: "finding:expectation:1:2:height",
  affectedComponent: "Header",
  expectedValue: "64px",
  actualValue: "66px",
  measurableDelta: 2,
});

export const BUTTON_26PX = finding({
  findingId: "finding:expectation:1:4:height",
  affectedComponent: "Primary button",
  expectedValue: "56px",
  actualValue: "30px",
  measurableDelta: -26,
  evidenceReferences: ["1:4", "viewport:desktop"],
});

export const MISSING_NAV = finding({
  findingId: "finding:expectation:1:5:presence",
  category: "missing-element",
  affectedComponent: "BottomNavigation",
  confidence: 1,
  expectedValue: "BottomNavigation",
  evidenceReferences: ["1:5", "viewport:desktop"],
});
