import { describe, expect, test } from "bun:test";
import { visualValidationReportV1Schema } from "@designflow/sdk";
import { selectActionableFindings } from "../../visual-correction/feedback-loop-selection";
import { type FeedbackLoopWorkflowInput } from "../../visual-correction/feedback-loop-types";

const hash = "a".repeat(64);
const input = (): FeedbackLoopWorkflowInput => ({
  schemaVersion: "1", workflowId: "design-to-code-feedback-loop", executionId: "exec-1", stateDirectory: "/tmp/designflow-state", currentImplementationHash: hash,
  project: { id: "p-1", name: "fixture", rootPath: "/tmp/fixture", canonicalRootIdentity: hash }, projectFingerprint: hash,
  generatedImplementation: { artifactId: "generated", artifactHash: hash, version: "1" }, latestVisualValidationReport: { artifactId: "report", artifactHash: hash, version: "1" }, designSpecification: { artifactId: "spec", artifactHash: hash, version: "1" }, designSystemMapping: { artifactId: "mapping", artifactHash: hash, version: "1" }, actionableFindingIds: ["f-major"], iterationPolicy: { maxIterations: 3, maxFilesPerIteration: 5, maxChangedBytesPerIteration: 200_000, maxDependenciesPerIteration: 0, maxFindingsPerIteration: 5, modelInterpretedAllowed: false, modelConfidenceThreshold: 0.9, requireApprovalEveryIteration: true, continueAfterImprovement: true }, validationConfiguration: { commands: [], timeoutMs: 1_000, outputLimitBytes: 10_000 }, viewportConfiguration: { viewports: [{ id: "desktop", width: 1440, height: 1024 }], referenceEvidenceIds: ["ref"], rendererVersion: "renderer-1", comparisonAlgorithmVersion: "png-rgba-pixel-diff-v1" }, agentVersion: "0.1.0", modelProfileId: "visual-correction-default", timeouts: { agentMs: 1_000, approvalMs: 60_000 }, limits: { maxContextBytes: 50_000, maxPatchBytes: 50_000 }, affectedFileMap: { "f-major": ["src/Header.tsx"] },
});

function report(overallStatus: "fail" | "pass" | "inconclusive" | "unavailable") {
  return visualValidationReportV1Schema.parse({ schemaVersion: "1", projectId: "p-1", projectRootIdentity: hash, generatedImplementationArtifactId: "generated", designSpecificationArtifactId: "spec", figmaSourceSnapshotArtifactId: "figma", referenceEvidence: [{ schemaVersion: "1", evidenceId: "ref", sourceType: "reference", frame: { id: "frame" }, viewport: { id: "desktop", width: 1440, height: 1024 }, image: { width: 1440, height: 1024, contentHash: hash, artifactId: "ref-png" }, capturedAt: new Date(0).toISOString(), captureMethod: "fake-mcp", warnings: [], authenticity: "fake-mcp" }], implementationEvidence: [{ schemaVersion: "1", evidenceId: "impl", sourceType: "implementation", frame: { id: "frame" }, viewport: { id: "desktop", width: 1440, height: 1024 }, image: { width: 1440, height: 1024, contentHash: hash, artifactId: "impl-png" }, capturedAt: new Date(0).toISOString(), captureMethod: "browser", warnings: [], authenticity: "browser-rendered" }], viewportResults: [{ viewport: { id: "desktop", width: 1440, height: 1024 }, status: overallStatus, implementationEvidenceIds: ["impl"], referenceEvidenceIds: ["ref"], findingIds: overallStatus === "fail" ? ["f-major"] : [], metrics: { pixelMismatchRatio: overallStatus === "fail" ? 0.2 : 0, dimensionCompatible: true }, warnings: [] }], findings: overallStatus === "fail" ? [{ schemaVersion: "1", findingId: "f-major", category: "size", severity: "major", confidence: 1, status: "confirmed", affectedFrame: "frame", affectedComponent: "Header", expectedValue: "96px", actualValue: "64px", measurableDelta: 32, explanation: "Header height differs.", evidenceReferences: ["impl", "ref"], origin: "deterministic" }] : [], summary: { byCategory: {}, bySeverity: overallStatus === "fail" ? { major: 1 } : {} }, coverage: { requestedViewports: 1, capturedViewports: overallStatus === "unavailable" ? 0 : 1, referenceViewports: 1, requiredViewportCoverage: overallStatus !== "unavailable" }, confidence: overallStatus === "unavailable" ? 0 : 1, limitations: [], captureWarnings: [], comparisonMode: "synthetic-fixture", overallStatus, passFailPolicy: { criticalFails: true, majorDeterministicFails: true, rendererFailureFails: true, missingRequiredViewportFails: true, unavailableReferenceIsInconclusive: true }, agent: { id: "visual-validation-agent", version: "0.1.0" }, traceIds: [] });
}

describe("Stage 6 finding selection", () => {
  test("selects only the evidence-bound major deterministic finding", () => {
    const selection = selectActionableFindings(report("fail"), input());
    expect(selection.selectedFindingIds).toEqual(["f-major"]);
    expect(selection.stopReason).toBeUndefined();
  });

  test("stops honestly for unavailable or inconclusive reports", () => {
    expect(selectActionableFindings(report("unavailable"), input()).stopReason).toBe("renderer_unavailable");
    expect(selectActionableFindings(report("inconclusive"), input()).stopReason).toBe("visual_validation_inconclusive");
  });
});

describe("MVP-4H root-frame content-divergence actionability", () => {
  function reportWith(findings: unknown[], findingIds: string[]) {
    const base = JSON.parse(JSON.stringify(report("fail"))) as Record<string, unknown>;
    (base.viewportResults as Array<Record<string, unknown>>)[0]!.findingIds = findingIds;
    base.findings = findings;
    return base;
  }

  const dimensionOnly = { schemaVersion: "1", findingId: "dimension-mismatch-mobile", category: "size", severity: "major", confidence: 1, status: "confirmed", expectedValue: "413x1024px", actualValue: "390x844px", measurableDelta: 180, explanation: "Dimensions differ.", evidenceReferences: ["impl", "ref"], origin: "deterministic" };
  const contentDivergence = { schemaVersion: "1", findingId: "content-divergence-mobile", category: "layout", severity: "major", confidence: 1, status: "confirmed", affectedFrame: "1026:6098", expectedValue: "overlap mismatch <= 0.005", actualValue: "0.8700", measurableDelta: 0.87, explanation: "Content differs within the comparable region.", evidenceReferences: ["impl", "ref"], origin: "deterministic" };

  test("a deterministic root-frame content finding is actionable; the bare dimension finding is not", () => {
    const workflowInput = { ...input(), actionableFindingIds: [], affectedFileMap: { "content-divergence-mobile": ["src/App.jsx"], "dimension-mismatch-mobile": ["src/App.jsx"] } };
    const selection = selectActionableFindings(reportWith([dimensionOnly, contentDivergence], ["dimension-mismatch-mobile", "content-divergence-mobile"]), workflowInput);
    expect(selection.selectedFindingIds).toEqual(["content-divergence-mobile"]);
    expect(selection.excludedFindingIds).toContain("dimension-mismatch-mobile");
    expect(selection.stopReason).toBeUndefined();
  });

  test("an instrumentation-only mismatch launches no correction", () => {
    const workflowInput = { ...input(), actionableFindingIds: [], affectedFileMap: { "dimension-mismatch-mobile": ["src/App.jsx"] } };
    const selection = selectActionableFindings(reportWith([dimensionOnly], ["dimension-mismatch-mobile"]), workflowInput);
    expect(selection.selectedFindingIds).toEqual([]);
    expect(selection.stopReason).toBe("no_actionable_findings");
  });
});
