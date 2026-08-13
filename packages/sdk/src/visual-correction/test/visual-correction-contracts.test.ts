import { describe, expect, test } from "bun:test";
import { correctionApprovalBindingV1Schema, feedbackLoopInputV1Schema, proposedCorrectionChangeV1Schema } from "../../visual-correction/visual-correction-contracts";

const hash = "a".repeat(64);

const input = {
  schemaVersion: "1" as const,
  workflowId: "design-to-code-feedback-loop" as const,
  executionId: "exec-1",
  project: { id: "project-1", name: "fixture", rootPath: "/tmp/fixture", canonicalRootIdentity: hash },
  projectFingerprint: hash,
  currentImplementationHash: hash,
  generatedImplementation: { artifactId: "generated-implementation", artifactHash: hash, version: "1" },
  latestVisualValidationReport: { artifactId: "visual-validation-report", artifactHash: hash, version: "1" },
  designSpecification: { artifactId: "design-specification", artifactHash: hash, version: "1" },
  designSystemMapping: { artifactId: "design-system-mapping", artifactHash: hash, version: "1" },
  actionableFindingIds: ["image-difference-desktop"],
  iterationPolicy: {},
  validationConfiguration: { commands: [] },
  viewportConfiguration: { viewports: [{ id: "desktop", width: 1440, height: 1024 }], referenceEvidenceIds: ["reference-desktop"], rendererVersion: "playwright-1", comparisonAlgorithmVersion: "png-rgba-pixel-diff-v1" },
  agentVersion: "0.1.0",
  modelProfileId: "visual-correction-default",
  timeouts: { agentMs: 1000, approvalMs: 60_000 },
  limits: { maxContextBytes: 50_000, maxPatchBytes: 50_000 },
};

describe("Stage 6 contracts", () => {
  test("accepts a bounded feedback loop input and applies strict defaults", () => {
    const parsed = feedbackLoopInputV1Schema.parse(input);
    expect(parsed.iterationPolicy.maxIterations).toBe(3);
    expect(parsed.iterationPolicy.requireApprovalEveryIteration).toBe(true);
  });

  test("rejects a path escape and a content-hash mismatch", () => {
    expect(() => feedbackLoopInputV1Schema.parse({ ...input, project: { ...input.project, canonicalRootIdentity: "bad" } })).toThrow();
    expect(() => proposedCorrectionChangeV1Schema.parse({ schemaVersion: "1", operation: "modify", relativePath: "../Header.tsx", baseFileHash: hash, proposedContentHash: hash, proposedContent: "x", reason: "fix", findingIds: ["f-1"], evidenceIds: ["e-1"], expectedMeasurableOutcome: {}, designSystemReferences: [], dependencyChangeRequired: false })).toThrow();
  });

  test("requires the exact approval binding fields", () => {
    expect(() => correctionApprovalBindingV1Schema.parse({ schemaVersion: "1", workflowId: "design-to-code-feedback-loop" })).toThrow();
  });
});
