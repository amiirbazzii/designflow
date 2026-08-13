import { describe, expect, test } from "bun:test";
import { visualFindingV1Schema, visualValidationReportV1Schema, visualViewportV1Schema } from "./visual-validation-contracts";

describe("Stage 5 visual validation contracts", () => {
  test("accepts bounded viewport definitions", () => {
    expect(visualViewportV1Schema.parse({ id: "desktop", width: 1440, height: 1024 })).toEqual({ id: "desktop", width: 1440, height: 1024 });
  });

  test("rejects unbounded viewport dimensions", () => {
    expect(() => visualViewportV1Schema.parse({ id: "desktop", width: 5000, height: 1024 })).toThrow();
  });

  test("rejects unknown finding categories", () => {
    expect(() => visualFindingV1Schema.parse({ schemaVersion: "1", findingId: "f-1", category: "invented", severity: "major", confidence: 1, status: "confirmed", explanation: "x", evidenceReferences: [], origin: "deterministic" })).toThrow();
  });

  test("keeps report status distinct from a boolean verdict", () => {
    const report = visualValidationReportV1Schema.parse({ schemaVersion: "1", projectId: "p", projectRootIdentity: "r", generatedImplementationArtifactId: "g", designSpecificationArtifactId: "s", figmaSourceSnapshotArtifactId: "f", referenceEvidence: [], implementationEvidence: [], viewportResults: [], findings: [], summary: { byCategory: {}, bySeverity: {} }, coverage: { requestedViewports: 0, capturedViewports: 0, referenceViewports: 0, requiredViewportCoverage: false }, confidence: 0, limitations: [], captureWarnings: [], comparisonMode: "insufficient-reference", overallStatus: "inconclusive", passFailPolicy: { criticalFails: true, majorDeterministicFails: true, rendererFailureFails: true, missingRequiredViewportFails: true, unavailableReferenceIsInconclusive: true }, agent: { id: "visual-validation-agent", version: "0.1.0" }, traceIds: [] });
    expect(report.overallStatus).toBe("inconclusive");
  });
});
