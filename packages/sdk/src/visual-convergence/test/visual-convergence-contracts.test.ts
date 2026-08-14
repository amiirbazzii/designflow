// packages/sdk/src/visual-convergence/test/visual-convergence-contracts.test.ts
import { describe, expect, test } from "bun:test";

import {
  VISUAL_CONVERGENCE_LIMITS,
  convergenceIterationSchema,
  visualConvergenceArtifactSchema,
} from "../visual-convergence-contracts";

const iteration = (overrides: Record<string, unknown> = {}) => ({
  iteration: 0,
  proposalHash: "a".repeat(64),
  proposalRef: "builder-proposal",
  renderedStateRef: "payload-rendered-0",
  reportRef: "payload-report-0",
  outcome: "needs_refinement",
  quality: {
    renderable: true,
    missingRequiredCount: 1,
    criticalCount: 0,
    majorCount: 3,
    unresolvedExpectationCount: 1,
    actionableCount: 4,
  },
  builderAttempts: 1,
  ...overrides,
});

const artifact = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1",
  status: "converged_with_findings",
  stopReason: "acceptable_with_findings",
  iterationLimit: 3,
  iterationsPerformed: 2,
  iterations: [iteration(), iteration({ iteration: 1, proposalHash: "b".repeat(64), repairsProposalHash: "a".repeat(64) })],
  selectedIteration: 1,
  selectedProposalRef: "builder-proposal-1",
  selectedProposalHash: "b".repeat(64),
  selectedRenderedStateRef: "payload-rendered-1",
  selectedVisualDeltaReportRef: "payload-report-1",
  selectionPolicyVersion: "1",
  metrics: {
    visualConvergenceIterationCount: 2,
    visualConvergenceRepairCount: 1,
    visualConvergenceInitialFindingCount: 4,
    visualConvergenceFinalFindingCount: 1,
    visualConvergenceResolvedCount: 3,
    visualConvergenceImprovedCount: 0,
    visualConvergenceRegressedCount: 0,
    visualConvergenceSelectedIteration: 1,
    visualConvergenceStopReason: "acceptable_with_findings",
  },
  notes: [],
  ...overrides,
});

describe("visual convergence contract", () => {
  test("one canonical limit source: 3 evaluated states, hard maximum 3", () => {
    expect(VISUAL_CONVERGENCE_LIMITS.defaultEvaluatedStates).toBe(3);
    expect(VISUAL_CONVERGENCE_LIMITS.hardMaxEvaluatedStates).toBe(3);
    // The schema itself rejects a limit above the hard maximum — a malformed
    // configuration cannot even be *recorded* as more than 3, let alone run.
    expect(visualConvergenceArtifactSchema.safeParse(artifact({ iterationLimit: 4 })).success).toBe(false);
    expect(
      visualConvergenceArtifactSchema.safeParse(
        artifact({ iterationsPerformed: 4, iterations: [iteration(), iteration(), iteration(), iteration()] }),
      ).success,
    ).toBe(false);
  });

  test("a valid convergence record round-trips", () => {
    const parsed = visualConvergenceArtifactSchema.parse(artifact());
    expect(parsed.iterations[1]!.repairsProposalHash).toBe("a".repeat(64));
    expect(parsed.selectedIteration).toBe(1);
  });

  test("the schema is strict: no room for proposal source or screenshots", () => {
    expect(
      visualConvergenceArtifactSchema.safeParse(artifact({ screenshots: ["..."] })).success,
    ).toBe(false);
    expect(convergenceIterationSchema.safeParse(iteration({ proposalSource: "code" })).success).toBe(false);
  });

  test("failure vocabulary is typed, not a single 'failed'", () => {
    for (const [status, stopReason] of [
      ["render_failed", "render_failed"],
      ["builder_failed", "builder_exhausted"],
      ["map_unexecutable", "map_unexecutable"],
      ["project_changed", "project_changed"],
      ["cancelled", "cancelled"],
    ])
      expect(visualConvergenceArtifactSchema.safeParse(artifact({ status, stopReason })).success).toBe(true);
    expect(visualConvergenceArtifactSchema.safeParse(artifact({ status: "failed" })).success).toBe(false);
  });
});
