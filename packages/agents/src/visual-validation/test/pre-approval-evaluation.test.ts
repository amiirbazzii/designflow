// packages/agents/src/visual-validation/test/pre-approval-evaluation.test.ts
//
// V2-5: the evaluation pipeline end to end, with a fake critic. No model is
// invoked. Rendering is the workflow package's job and is covered by
// `render-proposed-state.test.ts`; here the render's output is the input.
import { describe, expect, test } from "bun:test";

import { evaluateRenderedState } from "../pre-approval-evaluation";
import { BLUEPRINT, BROWSER_UNAVAILABLE, RENDER_FAILED, renderedWith } from "./fixtures/rendered-state-fixtures";
import { compileVisualExpectations } from "../visual-expectation-compiler";

const TEXTS = compileVisualExpectations(BLUEPRINT)
  .expectations.filter((expectation) => expectation.property === "text")
  .map((expectation) => expectation.expected);

/** Everything the design shows, rendered exactly. */
function faithful() {
  return renderedWith(TEXTS.map((text) => ({ text })));
}

/** Everything except one string. */
function missingOneString() {
  return renderedWith(TEXTS.filter((text) => text !== "Expense History").map((text) => ({ text })));
}

describe("pre-approval visual evaluation", () => {
  test("an implementation that carries the design's copy is not reported as missing it", async () => {
    const { report } = await evaluateRenderedState({ renderedState: faithful(), blueprint: BLUEPRINT });
    expect(
      report.findings.filter((finding) => finding.explanation.includes("no rendered element carries that text")),
    ).toHaveLength(0);
    expect(report.expectationCount).toBeGreaterThan(0);
  });

  test("missing design copy is caught before approval", async () => {
    const { report } = await evaluateRenderedState({ renderedState: missingOneString(), blueprint: BLUEPRINT });
    expect(["fail", "needs_refinement"]).toContain(report.outcome);
    expect(report.findings.some((finding) => finding.explanation.includes("Expense History"))).toBe(true);
  });

  test("the verdict is reached without a critic", async () => {
    const { report } = await evaluateRenderedState({ renderedState: missingOneString(), blueprint: BLUEPRINT });
    expect(report.critic.status).toBe("not_requested");
    expect(report.outcome).not.toBe("pass");
  });

  test("a critic adds interpretation without changing the verdict or the measurements", async () => {
    const withoutCritic = await evaluateRenderedState({ renderedState: missingOneString(), blueprint: BLUEPRINT });
    const withCritic = await evaluateRenderedState({
      renderedState: missingOneString(),
      blueprint: BLUEPRINT,
      criticModel: { modelProfileId: "visual-critic-default", model: "openai/gpt-4o-mini" },
      critic: async (evidence) => ({
        schemaVersion: "1",
        partitionId: evidence.partitionId,
        annotations: evidence.findings.map((finding) => ({
          findingId: finding.findingId,
          userVisibleImpact: "The history section is simply absent.",
          likelyCauseCategory: "content",
        })),
        summary: "The screen is missing its history section.",
        inconclusive: [],
      }),
    });

    expect(withCritic.report.outcome).toBe(withoutCritic.report.outcome);
    expect(withCritic.report.annotations.length).toBeGreaterThan(0);
    expect(withCritic.report.critic.status).toBe("completed");
    expect(withCritic.report.critic.model).toBe("openai/gpt-4o-mini");
    expect(withCritic.report.findings.map((finding) => finding.explanation)).toEqual(
      withoutCritic.report.findings.map((finding) => finding.explanation),
    );
  });

  test("a critic that fails costs interpretation and nothing else", async () => {
    const { report } = await evaluateRenderedState({
      renderedState: missingOneString(),
      blueprint: BLUEPRINT,
      critic: async () => {
        throw new Error("gateway refused");
      },
    });
    expect(report.critic.status).toBe("unavailable");
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.outcome).not.toBe("pass");
  });

  test("a critic that invents a finding is refused, and the report stays measured", async () => {
    const { report } = await evaluateRenderedState({
      renderedState: missingOneString(),
      blueprint: BLUEPRINT,
      critic: async (evidence) => ({
        schemaVersion: "1",
        partitionId: evidence.partitionId,
        annotations: [{ findingId: "finding:invented", userVisibleImpact: "The whole page is broken." }],
        inconclusive: [],
      }),
    });
    expect(report.annotations).toHaveLength(0);
    expect(JSON.stringify(report)).not.toContain("The whole page is broken.");
    expect(report.findings.every((finding) => finding.origin === "deterministic")).toBe(true);
  });

  test("no model is asked anything when there is nothing to interpret", async () => {
    let calls = 0;
    const { report } = await evaluateRenderedState({
      renderedState: faithful(),
      blueprint: BLUEPRINT,
      critic: async () => {
        calls += 1;
        return {};
      },
    });
    if (report.findings.length === 0) {
      expect(calls).toBe(0);
      expect(report.critic.status).toBe("not_requested");
    }
  });

  test("a failed render is a failure, and never reaches the critic", async () => {
    let calls = 0;
    const { report } = await evaluateRenderedState({
      renderedState: RENDER_FAILED,
      blueprint: BLUEPRINT,
      critic: async () => {
        calls += 1;
        return {};
      },
    });
    expect(report.outcome).toBe("fail");
    expect(calls).toBe(0);
  });

  test("no browser is inconclusive, and every expectation is reported unevaluated", async () => {
    const { report, unevaluatedExpectationIds } = await evaluateRenderedState({
      renderedState: BROWSER_UNAVAILABLE,
      blueprint: BLUEPRINT,
    });
    expect(report.outcome).toBe("inconclusive");
    expect(unevaluatedExpectationIds.length).toBe(report.expectationCount);
  });
});
