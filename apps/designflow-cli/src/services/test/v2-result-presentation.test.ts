// apps/designflow-cli/src/services/test/v2-result-presentation.test.ts
import { describe, expect, test } from "bun:test";

import {
  convergenceFacts,
  finalOutcomeLines,
  refinementStoryLines,
  v2ReviewChecks,
  visualSummaryLine,
} from "../v2-result-presentation";

const iteration = (n: number, actionable: number, comparison?: { resolved?: number; improved?: number; regressed?: number; introduced?: number }) => ({
  iteration: n,
  quality: { actionableCount: actionable, missingRequiredCount: 0 },
  ...(comparison === undefined
    ? {}
    : { comparison: { resolved: 0, improved: 0, regressed: 0, introduced: 0, ...comparison } }),
});

describe("V2 visual and outcome presentation (V2-9)", () => {
  test("a converged run reads as a passed visual check", () => {
    const facts = convergenceFacts({ status: "converged", iterationsPerformed: 1, iterations: [iteration(0, 0)], selectedIteration: 0 })!;
    expect(visualSummaryLine(facts)).toBe("Visual check passed");
    // No repair ran: no Refining story at all (§54).
    expect(refinementStoryLines(facts)).toEqual([]);
  });

  test("the bounded refinement story names iterations and the selection (§19)", () => {
    const facts = convergenceFacts({
      status: "exhausted",
      iterationsPerformed: 3,
      iterations: [
        iteration(0, 4),
        iteration(1, 1, { resolved: 2, improved: 1 }),
        iteration(2, 1, { introduced: 1 }),
      ],
      selectedIteration: 1,
    })!;
    const story = refinementStoryLines(facts);
    expect(story[0]).toBe("Refining");
    expect(story.join("\n")).toContain("Iteration 2 — 2 resolved, 1 improved");
    expect(story.join("\n")).toContain("Iteration 3 — introduced a regression");
    expect(story.join("\n")).toContain("Iteration 2 of 3");
    expect(story.join("\n")).toContain("stronger earlier implementation was kept");
  });

  test("inconclusive is stated, never dressed up (§74)", () => {
    const facts = convergenceFacts({ status: "inconclusive", iterationsPerformed: 1, iterations: [iteration(0, 0)] })!;
    expect(visualSummaryLine(facts)).toBe("Visual verification inconclusive");
  });

  test("review checks state the visual outcome and the selected iteration (§22)", () => {
    const checks = v2ReviewChecks({
      convergence: { status: "converged_with_findings", selectedIteration: 2, iterationsPerformed: 3 },
      visual: { remainingFindingCount: 1 },
      files: [{ path: "src/App.jsx" }],
    });
    const labels = checks.map((check) => check.label);
    expect(labels).toContain("Visual result acceptable with 1 remaining difference");
    expect(labels).toContain("Selected iteration 3 of 3");
  });

  test("final outcomes map to actionable product copy (§24–§28)", () => {
    expect(finalOutcomeLines({ status: "applied_validated", metrics: { finalizationFilesApplied: 3 } }).join("\n")).toContain("Implementation complete");
    expect(finalOutcomeLines({ status: "validation_failed_rolled_back" }).join("\n")).toContain("restored to the previous state");
    expect(finalOutcomeLines({ status: "approval_declined" }).join("\n")).toContain("You declined the implementation");
    expect(finalOutcomeLines({ status: "project_changed" }).join("\n")).toContain("Run again to generate an implementation");
    // No internal vocabulary anywhere in normal copy.
    for (const status of ["applied_validated", "approval_declined", "project_changed", "cancelled"]) {
      const text = finalOutcomeLines({ status }).join("\n");
      expect(text).not.toMatch(/v2|proposalHash|workflow|schema/i);
    }
  });
});
