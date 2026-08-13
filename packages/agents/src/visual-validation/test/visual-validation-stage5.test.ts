import { describe, expect, test } from "bun:test";
import { visualValidationAgentOutputV1Schema, visualValidationInputV1Schema } from "@designflow/sdk";
import { SpecializedAgentOutputInvalidError } from "../../errors";
import { deterministicVisualValidationStrategy, modelVisualValidationStrategy, visualValidationAgentManifest } from "../visual-validation-agent";

const EMPTY_CONTEXT = { tools: { call: async () => { throw new Error("tools unavailable"); } }, model: { generate: async () => { throw new Error("model unavailable"); } }, metadata: {}, signal: new AbortController().signal, logger: { info() {}, warn() {}, error() {}, debug() {} } };
const INPUT = visualValidationInputV1Schema.parse({
  schemaVersion: "1", executionId: "execution-1", workflowId: "design-to-code-visual-validation", project: { id: "project-1", rootIdentity: "root-1", contextFingerprint: "fingerprint-1" }, generatedImplementationArtifactId: "generated-implementation", designSpecificationArtifactId: "design-specification", figmaSourceSnapshotArtifactId: "figma-source-snapshot", requestedFrames: ["Header"], framework: "react", preview: { readinessPath: "/" }, viewports: [{ id: "desktop", width: 1440, height: 1024 }], capture: {}, agentVersion: "0.1.0",
});

describe("Stage 5 Visual Validation Agent", () => {
  test("returns evidence-bound structured output", async () => {
    const output = await deterministicVisualValidationStrategy({ agentId: "visual-validation-agent", objective: "validate", input: { visualValidationInput: INPUT, evidenceIds: ["implementation-desktop"], deterministicFindings: [{ schemaVersion: "1", findingId: "f-1", category: "color", severity: "minor", confidence: 1, status: "confirmed", explanation: "Color differs.", evidenceReferences: ["implementation-desktop"], origin: "deterministic" }] }, attempt: 1 }, EMPTY_CONTEXT, visualValidationAgentManifest);
    expect(visualValidationAgentOutputV1Schema.parse(output).findings[0]?.findingId).toBe("f-1");
  });

  test("rejects a deterministic finding that cites unknown evidence", async () => {
    await expect(deterministicVisualValidationStrategy({ agentId: "visual-validation-agent", objective: "validate", input: { visualValidationInput: INPUT, evidenceIds: [], deterministicFindings: [{ schemaVersion: "1", findingId: "f-1", category: "color", severity: "minor", confidence: 1, status: "confirmed", explanation: "Invented.", evidenceReferences: ["not-supplied"], origin: "deterministic" }] }, attempt: 1 }, EMPTY_CONTEXT, visualValidationAgentManifest)).rejects.toBeInstanceOf(SpecializedAgentOutputInvalidError);
  });

  test("rejects model output that cites evidence the workflow did not supply", async () => {
    const context = { ...EMPTY_CONTEXT, model: { generate: async () => ({ type: "success" as const, output: { findings: [{ schemaVersion: "1", findingId: "model-1", category: "layout", severity: "major", confidence: 0.8, status: "confirmed", explanation: "Unsupported.", evidenceReferences: ["hallucinated"], origin: "model-interpreted" }], interpretation: "Unsupported." } }) } };
    await expect(modelVisualValidationStrategy({ agentId: "visual-validation-agent", objective: "validate", input: { visualValidationInput: INPUT, evidenceIds: [], deterministicFindings: [] }, attempt: 1 }, context, visualValidationAgentManifest)).rejects.toBeInstanceOf(SpecializedAgentOutputInvalidError);
  });
});
