// workflows/workflow-design-to-code/src/evaluate.test.ts
import { describe, expect, test } from "bun:test";
import type { EvaluableArtifact } from "@designflow/sdk";
import { evaluateDesignEngineerCriterion } from "./evaluate";
import { ARTIFACT_IDS } from "./types";

/**
 * Proves the Design Engineer's first deterministic evaluation layer against
 * fixtures built from this workflow's own Zod schema — never redefined here.
 */

function artifact(id: string, overrides?: Partial<EvaluableArtifact>): EvaluableArtifact {
  return { artifactId: id, status: "created", ...overrides };
}

function payloadReader(payloads: Record<string, unknown>) {
  return (artifactId: string): unknown => payloads[artifactId];
}

describe("evaluateDesignEngineerCriterion", () => {
  test("a well-formed execution satisfies its required criteria", () => {
    const artifacts = [
      artifact(ARTIFACT_IDS.designAnalysis),
      artifact(ARTIFACT_IDS.designTokens),
      artifact(ARTIFACT_IDS.componentTree),
      artifact(ARTIFACT_IDS.sourceCode),
      artifact(ARTIFACT_IDS.validationReport),
    ];

    const payloads = payloadReader({
      [ARTIFACT_IDS.validationReport]: { passed: true, checked: 4, issues: [] },
    });

    const validates = evaluateDesignEngineerCriterion("output-validates", artifacts, payloads);
    expect(validates.satisfied).toBe(true);

    const produced = evaluateDesignEngineerCriterion("expected-artifacts-produced", artifacts, payloads);
    expect(produced.satisfied).toBe(true);

    // Not required, and cannot be decided deterministically.
    const reuse = evaluateDesignEngineerCriterion("design-system-reuse-detected", artifacts, payloads);
    expect(reuse.satisfied).toBeUndefined();
    expect(reuse.note).toBeDefined();
  });

  test("a missing artifact fails deterministically instead of throwing", () => {
    const artifacts = [
      artifact(ARTIFACT_IDS.designAnalysis),
      artifact(ARTIFACT_IDS.designTokens),
      artifact(ARTIFACT_IDS.validationReport),
      // component-tree and source-code are missing.
    ];

    const payloads = payloadReader({
      [ARTIFACT_IDS.validationReport]: { passed: true, checked: 4, issues: [] },
    });

    let result;
    expect(() => {
      result = evaluateDesignEngineerCriterion("expected-artifacts-produced", artifacts, payloads);
    }).not.toThrow();

    expect(result?.satisfied).toBe(false);
    expect(result?.note).toContain("component-tree");
    expect(result?.note).toContain("source-code");
  });
});
