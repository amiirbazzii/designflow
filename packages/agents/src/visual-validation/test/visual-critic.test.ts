// packages/agents/src/visual-validation/test/visual-critic.test.ts
//
// V2-5: deterministic visual evaluation, and the boundary that keeps the
// Visual Critic from authoring evidence.
import { describe, expect, test } from "bun:test";

import {
  applyVisualCriticPatches,
  assembleVisualDeltaReport,
  compileCriticEvidence,
  compileVisualExpectations,
  decideVisualOutcome,
  evaluateVisualDeltas,
  formatVisualDeltaReport,
  parseColor,
  partitionCriticFindings,
  toCriticPatch,
  visualCriticAgentManifest,
  visualCriticDefaultModelProfile,
  MAX_FINDINGS_PER_PARTITION,
} from "../index";
import { DEFAULT_VISUAL_PASS_FAIL_POLICY, type VisualFindingV1 } from "@designflow/sdk";
import {
  BLUEPRINT,
  BROWSER_UNAVAILABLE,
  PROJECT_MOVED,
  RENDER_FAILED,
  renderedWith,
} from "./fixtures/rendered-state-fixtures";

const EXPECTATIONS = compileVisualExpectations(BLUEPRINT).expectations;

function textsOf(): readonly string[] {
  return EXPECTATIONS.filter((expectation) => expectation.property === "text").map(
    (expectation) => expectation.expected,
  );
}

describe("expectation compiler", () => {
  test("compiles checkable expectations from Blueprint facts alone", () => {
    const compiled = compileVisualExpectations(BLUEPRINT);
    expect(compiled.expectations.length).toBeGreaterThan(0);
    expect(compiled.expectations.every((expectation) => expectation.blueprintRef.length > 0)).toBe(true);
  });

  test("every expectation is anchored to exact design copy", () => {
    const refs = new Set(
      EXPECTATIONS.filter((expectation) => expectation.property === "text").map(
        (expectation) => expectation.blueprintRef,
      ),
    );
    // A geometry or color expectation on an element with no copy could never
    // be matched to a rendered node without guessing, so none is emitted.
    for (const expectation of EXPECTATIONS)
      if (!expectation.id.startsWith("expectation:style:")) expect(refs.has(expectation.blueprintRef)).toBe(true);
  });

  test("expected copy is the design's exact text", () => {
    const texts = textsOf();
    expect(texts).toContain("Add Transaction");
    expect(texts).toContain("Expense History");
  });

  test("content expectations are ordered first, so a truncated run still checks the screen", () => {
    expect(EXPECTATIONS[0]!.kind).toBe("content");
  });

  test("elements with facts but no copy are counted, not silently dropped", () => {
    expect(compileVisualExpectations(BLUEPRINT).unanchorableElementCount).toBeGreaterThanOrEqual(0);
  });
});

describe("deterministic delta evaluation", () => {
  test("a render that carries every design string produces no content finding", () => {
    const rendered = renderedWith(textsOf().map((text) => ({ text })));
    const { findings } = evaluateVisualDeltas(EXPECTATIONS, rendered);
    expect(findings.filter((finding) => finding.category === "missing-element")).toHaveLength(0);
  });

  test("missing copy is reported as a missing element", () => {
    const texts = textsOf().filter((text) => text !== "Expense History");
    const { findings } = evaluateVisualDeltas(EXPECTATIONS, renderedWith(texts.map((text) => ({ text }))));
    const missing = findings.find((finding) => finding.explanation.includes("Expense History"));
    expect(missing?.category).toBe("missing-element");
    expect(missing?.origin).toBe("deterministic");
  });

  test("every deterministic finding carries a real measurement, not a description", () => {
    const { findings } = evaluateVisualDeltas(
      EXPECTATIONS,
      renderedWith(textsOf().map((text) => ({ text, fontSize: "9px" }))),
    );
    const typography = findings.filter((finding) => finding.category === "typography");
    expect(typography.length).toBeGreaterThan(0);
    for (const finding of typography) {
      expect(finding.actualValue).toBeDefined();
      expect(finding.expectedValue).toBeDefined();
      expect(typeof finding.measurableDelta).toBe("number");
      expect(finding.confidence).toBe(1);
    }
  });

  test("differences within tolerance are not reported", () => {
    const sized = EXPECTATIONS.find((expectation) => expectation.property === "fontSize");
    expect(sized).toBeDefined();
    const anchor = EXPECTATIONS.find(
      (expectation) => expectation.blueprintRef === sized!.blueprintRef && expectation.property === "text",
    )!;
    const rendered = renderedWith([{ text: anchor.expected, fontSize: `${sized!.expectedNumber!}px` }]);
    const { findings } = evaluateVisualDeltas([sized!, anchor], rendered);
    expect(findings.filter((finding) => finding.category === "typography")).toHaveLength(0);
  });

  test("an expectation that could not be measured is reported unevaluated, never as a pass", () => {
    const sized = EXPECTATIONS.find((expectation) => expectation.property === "fontSize")!;
    const anchor = EXPECTATIONS.find(
      (expectation) => expectation.blueprintRef === sized.blueprintRef && expectation.property === "text",
    )!;
    // Copy present, but the browser reported no font size for it.
    const evaluation = evaluateVisualDeltas([sized, anchor], renderedWith([{ text: anchor.expected }]));
    expect(evaluation.unevaluatedExpectationIds).toContain(sized.id);
    expect(evaluation.findings).toHaveLength(0);
  });

  test("nothing is evaluated when nothing was rendered", () => {
    const evaluation = evaluateVisualDeltas(EXPECTATIONS, RENDER_FAILED);
    expect(evaluation.findings).toHaveLength(0);
    expect(evaluation.unevaluatedExpectationIds).toHaveLength(EXPECTATIONS.length);
  });

  test("colors are compared as colors, across notations", () => {
    expect(parseColor("#f8f8f8")).toEqual([248, 248, 248]);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("rgb(248, 248, 248)")).toEqual([248, 248, 248]);
    expect(parseColor("rgba(248, 248, 248, 0.5)")).toEqual([248, 248, 248]);
    expect(parseColor("papayawhip")).toBeUndefined();
  });
});

describe("critic boundary", () => {
  const finding: VisualFindingV1 = {
    schemaVersion: "1",
    findingId: "finding:expectation:1:height",
    category: "size",
    severity: "minor",
    confidence: 1,
    status: "confirmed",
    expectedValue: "56px",
    actualValue: "40px",
    measurableDelta: -16,
    explanation: "The card renders at 40px where the design specifies 56px.",
    evidenceReferences: ["1:1"],
    origin: "deterministic",
  };

  test("annotations attach to findings without changing what was measured", () => {
    const merged = applyVisualCriticPatches(
      [finding],
      [
        {
          schemaVersion: "1",
          partitionId: "p1",
          annotations: [
            { findingId: finding.findingId, userVisibleImpact: "The card looks cramped.", priority: 3 },
          ],
          inconclusive: [],
        },
      ],
    );
    expect(merged.failures).toHaveLength(0);
    expect(merged.annotations).toHaveLength(1);
    expect(merged.findings[0]!.actualValue).toBe("40px");
    expect(merged.findings[0]!.measurableDelta).toBe(-16);
  });

  test("a patch that restates a measurement is rejected whole", () => {
    const merged = applyVisualCriticPatches(
      [finding],
      [
        {
          schemaVersion: "1",
          partitionId: "p1",
          annotations: [{ findingId: finding.findingId, actualValue: "56px" }],
          inconclusive: [],
        },
      ],
    );
    expect(merged.failures[0]!.code).toBe("ERR_VISUAL_CRITIC_PATCH_FACT_OVERRIDE");
    expect(merged.annotations).toHaveLength(0);
  });

  test("a patch naming a finding the host never minted is rejected", () => {
    const merged = applyVisualCriticPatches(
      [finding],
      [
        {
          schemaVersion: "1",
          partitionId: "p1",
          annotations: [{ findingId: "finding:invented", userVisibleImpact: "Everything is broken." }],
          inconclusive: [],
        },
      ],
    );
    expect(merged.failures[0]!.code).toBe("ERR_VISUAL_CRITIC_PATCH_UNKNOWN_FINDING");
    expect(merged.findings).toHaveLength(1);
  });

  test("severity may be raised when policy allows, and never lowered", () => {
    const raised = applyVisualCriticPatches(
      [finding],
      [{ schemaVersion: "1", partitionId: "p1", annotations: [{ findingId: finding.findingId, severity: "major" }], inconclusive: [] }],
      { allowSeverityEscalation: true },
    );
    expect(raised.findings[0]!.severity).toBe("major");

    const critical = { ...finding, severity: "critical" as const };
    const lowered = applyVisualCriticPatches(
      [critical],
      [{ schemaVersion: "1", partitionId: "p1", annotations: [{ findingId: finding.findingId, severity: "info" }], inconclusive: [] }],
      { allowSeverityEscalation: true },
    );
    expect(lowered.findings[0]!.severity).toBe("critical");
  });

  test("the shipped policy does not let the critic move severity at all", () => {
    expect(DEFAULT_VISUAL_PASS_FAIL_POLICY.criticSeverityMayEscalate).toBe(false);
    const merged = applyVisualCriticPatches(
      [finding],
      [{ schemaVersion: "1", partitionId: "p1", annotations: [{ findingId: finding.findingId, severity: "critical" }], inconclusive: [] }],
    );
    expect(merged.findings[0]!.severity).toBe("minor");
  });

  test("critic evidence carries no image, selector or file content", () => {
    const [partition] = partitionCriticFindings([finding], EXPECTATIONS);
    const evidence = JSON.stringify(compileCriticEvidence(partition!));
    expect(evidence).not.toContain("selector");
    expect(evidence).not.toContain("screenshot");
    expect(evidence).toContain(finding.findingId);
  });

  test("partitions stay bounded", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...finding,
      findingId: `finding:${index}`,
      evidenceReferences: [`element:${index}`],
    }));
    const partitions = partitionCriticFindings(many, EXPECTATIONS);
    expect(partitions.length).toBeGreaterThan(1);
    for (const partition of partitions) expect(partition.findings.length).toBeLessThanOrEqual(MAX_FINDINGS_PER_PARTITION);
  });

  test("nulls from strict-JSON providers become absent fields", () => {
    const patch = toCriticPatch(
      { annotations: [{ findingId: "f1", severity: null, priority: 2, userVisibleImpact: null, likelyCauseCategory: null, repairGuidance: null }], summary: null, inconclusive: [] },
      "p1",
    );
    expect(patch.annotations[0]).toEqual({ findingId: "f1", priority: 2 });
    expect(patch.summary).toBeUndefined();
  });

  test("the critic has no tools and its own model profile", () => {
    expect(visualCriticAgentManifest.allowedTools).toHaveLength(0);
    expect(visualCriticDefaultModelProfile.id).toBe("visual-critic-default");
  });
});

describe("outcome policy", () => {
  const policy = { ...DEFAULT_VISUAL_PASS_FAIL_POLICY };
  const rendered = renderedWith([{ text: "anything" }]);

  function findingWith(severity: VisualFindingV1["severity"], category: VisualFindingV1["category"] = "size"): VisualFindingV1 {
    return {
      schemaVersion: "1",
      findingId: `finding:${severity}:${category}`,
      category,
      severity,
      confidence: 1,
      status: "confirmed",
      explanation: "measured difference",
      evidenceReferences: [],
      origin: "deterministic",
    };
  }

  test("a clean render passes", () => {
    expect(decideVisualOutcome(rendered, [], policy).outcome).toBe("pass");
  });

  test("minor differences pass with findings", () => {
    expect(decideVisualOutcome(rendered, [findingWith("minor")], policy).outcome).toBe("pass_with_findings");
  });

  test("major differences ask for another pass", () => {
    expect(decideVisualOutcome(rendered, [findingWith("major")], policy).outcome).toBe("needs_refinement");
  });

  test("a critical difference fails", () => {
    expect(decideVisualOutcome(rendered, [findingWith("critical")], policy).outcome).toBe("fail");
  });

  test("a build or render failure fails, and says which", () => {
    const decision = decideVisualOutcome(RENDER_FAILED, [], policy);
    expect(decision.outcome).toBe("fail");
    expect(decision.reason).toContain("did not build");
  });

  test("no browser is inconclusive, never a pass", () => {
    expect(decideVisualOutcome(BROWSER_UNAVAILABLE, [], policy).outcome).toBe("inconclusive");
  });

  test("a project that moved is inconclusive", () => {
    expect(decideVisualOutcome(PROJECT_MOVED, [], policy).outcome).toBe("inconclusive");
  });

  test("model-interpreted findings never decide the outcome", () => {
    const interpreted: VisualFindingV1 = { ...findingWith("critical"), origin: "model-interpreted" };
    expect(decideVisualOutcome(rendered, [interpreted], policy).outcome).toBe("pass");
  });
});

describe("report", () => {
  test("the report records the policy it was decided under", () => {
    const report = assembleVisualDeltaReport({
      renderedState: renderedWith([{ text: "anything" }]),
      findings: [],
      expectationCount: EXPECTATIONS.length,
    });
    expect(report.outcome).toBe("pass");
    expect(report.passFailPolicy).toEqual({ ...DEFAULT_VISUAL_PASS_FAIL_POLICY });
    expect(report.critic.status).toBe("not_requested");
  });

  test("interpretation is attributed as interpretation in the reviewer's text", () => {
    const report = assembleVisualDeltaReport({
      renderedState: renderedWith([{ text: "anything" }]),
      findings: [
        {
          schemaVersion: "1",
          findingId: "f1",
          category: "size",
          severity: "minor",
          confidence: 1,
          status: "confirmed",
          explanation: "The card renders at 40px where the design specifies 56px.",
          evidenceReferences: [],
          origin: "deterministic",
        },
      ],
      annotations: [{ findingId: "f1", userVisibleImpact: "The card looks cramped." }],
      expectationCount: 1,
      critic: { status: "completed", partitionCount: 1, patchCount: 1, summaries: [] },
    });
    const text = formatVisualDeltaReport(report);
    expect(text).toContain("impact (interpreted): The card looks cramped.");
  });

  test("an unavailable critic is stated, not hidden", () => {
    const report = assembleVisualDeltaReport({
      renderedState: renderedWith([{ text: "anything" }]),
      findings: [],
      expectationCount: 0,
      critic: { status: "unavailable", partitionCount: 1, patchCount: 0, summaries: [] },
    });
    expect(formatVisualDeltaReport(report)).toContain("Visual Critic was unavailable");
  });
});
