// workflows/workflow-product-brief/src/evaluate.test.ts
import { describe, expect, test } from "bun:test";
import type { EvaluableArtifact } from "@designflow/sdk";
import { evaluateProductManagerCriterion } from "./evaluate";
import { ARTIFACT_IDS } from "./types";

/**
 * Proves the Product Manager's first deterministic evaluation layer against
 * fixtures built from this workflow's own Zod schema — never redefined here.
 */

function artifact(id: string, overrides?: Partial<EvaluableArtifact>): EvaluableArtifact {
  return { artifactId: id, status: "created", ...overrides };
}

function payloadReader(payloads: Record<string, unknown>) {
  return (artifactId: string): unknown => payloads[artifactId];
}

describe("evaluateProductManagerCriterion", () => {
  test("a well-formed brief satisfies its required criteria", () => {
    const artifacts = [
      artifact(ARTIFACT_IDS.problemStatement),
      artifact(ARTIFACT_IDS.requirements),
      artifact(ARTIFACT_IDS.acceptanceCriteria),
      artifact(ARTIFACT_IDS.riskAssumptionRegister),
      artifact(ARTIFACT_IDS.scopeDefinition),
    ];

    const payloads = payloadReader({
      [ARTIFACT_IDS.problemStatement]: {
        targetUser: "Existing DesignFlow CLI users",
        problem: "Users cannot export their history",
        motivation: "Not specified",
        requestLines: ["Let users export their history as CSV"],
      },
      [ARTIFACT_IDS.requirements]: {
        items: [{ id: "req-1", description: "Export history as CSV", priority: "high" }],
      },
      [ARTIFACT_IDS.acceptanceCriteria]: {
        items: [
          {
            id: "ac-1",
            requirementId: "req-1",
            description: "A CSV file downloads when the user clicks export",
            measurable: true,
          },
        ],
      },
      [ARTIFACT_IDS.riskAssumptionRegister]: {
        items: [{ id: "risk-1", kind: "risk", description: "Large histories may time out", source: "req-1" }],
      },
      [ARTIFACT_IDS.scopeDefinition]: {
        inScope: ["CSV export"],
        outOfScope: ["JSON export"],
      },
    });

    expect(evaluateProductManagerCriterion("user-problem-defined", artifacts, payloads).satisfied).toBe(true);
    expect(evaluateProductManagerCriterion("acceptance-criteria-measurable", artifacts, payloads).satisfied).toBe(
      true,
    );
    expect(evaluateProductManagerCriterion("risks-and-exclusions-included", artifacts, payloads).satisfied).toBe(
      true,
    );
  });

  test("a requirement with no linked acceptance criterion fails deterministically instead of throwing", () => {
    const artifacts = [artifact(ARTIFACT_IDS.requirements), artifact(ARTIFACT_IDS.acceptanceCriteria)];

    const payloads = payloadReader({
      [ARTIFACT_IDS.requirements]: {
        items: [
          { id: "req-1", description: "Export history as CSV", priority: "high" },
          { id: "req-2", description: "Support scheduled exports", priority: "medium" },
        ],
      },
      // Malformed: req-2 has no linked, measurable acceptance criterion.
      [ARTIFACT_IDS.acceptanceCriteria]: {
        items: [
          {
            id: "ac-1",
            requirementId: "req-1",
            description: "A CSV file downloads when the user clicks export",
            measurable: true,
          },
        ],
      },
    });

    let result;
    expect(() => {
      result = evaluateProductManagerCriterion("acceptance-criteria-measurable", artifacts, payloads);
    }).not.toThrow();

    expect(result?.satisfied).toBe(false);
    expect(result?.note).toContain("req-2");
  });
});
