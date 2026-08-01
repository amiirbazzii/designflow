// workflows/workflow-research-analysis/src/evaluate.test.ts
import { describe, expect, test } from "bun:test";
import type { EvaluableArtifact } from "@designflow/sdk";
import { evaluateResearchAnalystCriterion } from "./evaluate";
import { ARTIFACT_IDS } from "./types";

/**
 * Proves the Research Analyst's first deterministic evaluation layer against
 * fixtures built from this workflow's own Zod schema — never redefined here.
 */

function artifact(id: string, overrides?: Partial<EvaluableArtifact>): EvaluableArtifact {
  return { artifactId: id, status: "created", ...overrides };
}

function payloadReader(payloads: Record<string, unknown>) {
  return (artifactId: string): unknown => payloads[artifactId];
}

describe("evaluateResearchAnalystCriterion", () => {
  test("claims that all cite supplied sources satisfy the required criteria", () => {
    const artifacts = [
      artifact(ARTIFACT_IDS.sourceInventory),
      artifact(ARTIFACT_IDS.extractedClaims),
      artifact(ARTIFACT_IDS.comparisonMatrix),
      artifact(ARTIFACT_IDS.researchBrief),
    ];

    const payloads = payloadReader({
      [ARTIFACT_IDS.sourceInventory]: {
        question: "Server components vs client components?",
        totalSources: 2,
        validSources: [
          { id: "source-1", title: "RSC deep dive", text: "Server components run on the server." },
          { id: "source-2", title: "Client hydration", text: "Client components hydrate in the browser." },
        ],
        invalidSources: [],
      },
      [ARTIFACT_IDS.extractedClaims]: {
        question: "Server components vs client components?",
        claims: [
          { id: "claim-1", sourceId: "source-1", text: "Server components reduce client bundle size." },
          { id: "claim-2", sourceId: "source-2", text: "Client components support interactivity." },
        ],
      },
      [ARTIFACT_IDS.comparisonMatrix]: {
        question: "Server components vs client components?",
        groups: [
          {
            id: "group-1",
            representativeText: "Server components reduce bundle size",
            claimIds: ["claim-1"],
            sourceIds: ["source-1"],
            agreement: "single-source",
          },
        ],
      },
      [ARTIFACT_IDS.researchBrief]: {
        question: "Server components vs client components?",
        sourceInventory: { totalSources: 2, validSourceCount: 2, invalidSourceCount: 0 },
        keyFindings: [],
        conflicts: [],
        citations: [],
      },
    });

    const linked = evaluateResearchAnalystCriterion("claims-linked-to-sources", artifacts, payloads);
    expect(linked.satisfied).toBe(true);

    const unsupported = evaluateResearchAnalystCriterion("unsupported-claims-flagged", artifacts, payloads);
    expect(unsupported.satisfied).toBe(true);
    expect(unsupported.value).toBe(0);

    // No conflict groups exist, so the conflict criterion is vacuously satisfied.
    const conflict = evaluateResearchAnalystCriterion("conflicting-findings-identified", artifacts, payloads);
    expect(conflict.satisfied).toBe(true);
  });

  test("a claim citing an unknown source fails deterministically instead of throwing", () => {
    const artifacts = [artifact(ARTIFACT_IDS.sourceInventory), artifact(ARTIFACT_IDS.extractedClaims)];

    const payloads = payloadReader({
      [ARTIFACT_IDS.sourceInventory]: {
        question: "Server components vs client components?",
        totalSources: 1,
        validSources: [{ id: "source-1", title: "RSC deep dive", text: "Server components run on the server." }],
        invalidSources: [],
      },
      // Malformed: the claim cites a source id that was never in the supplied inventory.
      [ARTIFACT_IDS.extractedClaims]: {
        question: "Server components vs client components?",
        claims: [{ id: "claim-1", sourceId: "source-does-not-exist", text: "An unsupported claim." }],
      },
    });

    let linked;
    let unsupported;
    expect(() => {
      linked = evaluateResearchAnalystCriterion("claims-linked-to-sources", artifacts, payloads);
      unsupported = evaluateResearchAnalystCriterion("unsupported-claims-flagged", artifacts, payloads);
    }).not.toThrow();

    expect(linked?.satisfied).toBe(false);
    expect(linked?.note).toBeDefined();

    expect(unsupported?.value).toBe(1);
    expect(unsupported?.satisfied).toBe(false);
  });
});
