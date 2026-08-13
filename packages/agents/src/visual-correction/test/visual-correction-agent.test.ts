import { describe, expect, test } from "bun:test";
import { EMPTY_MODEL_SERVICE, EMPTY_TOOL_SERVICE } from "../../index";
import { deterministicVisualCorrectionStrategy, visualCorrectionAgentManifest } from "../visual-correction-agent";

const hash = "a".repeat(64);
const context = {
  schemaVersion: "1" as const,
  iterationNumber: 1,
  selectedFindings: [{ findingId: "image-difference-desktop", classification: "deterministic" as const, affectedFiles: ["src/Header.tsx"], component: "Header", evidenceReferences: ["implementation-desktop", "reference-desktop"], expected: "96px", actual: "64px", measurableDelta: 32 }],
  visualFindings: [{ schemaVersion: "1" as const, findingId: "image-difference-desktop", category: "size" as const, severity: "major" as const, confidence: 1, status: "confirmed" as const, affectedComponent: "Header", expectedValue: "96px", actualValue: "64px", measurableDelta: 32, explanation: "Header height differs.", evidenceReferences: ["implementation-desktop", "reference-desktop"], origin: "deterministic" as const }],
  evidenceReferences: [{ artifactId: "implementation-desktop", artifactHash: hash, version: "1" }, { artifactId: "reference-desktop", artifactHash: hash, version: "1" }],
  currentImplementationExcerpts: [{ path: "src/Header.tsx", content: "export const Header = () => <header style={{height: '64px'}}>Header</header>;", hash: "d".repeat(64) }],
  relevantDesignTokens: [], relevantComponents: [], allowedFileScope: ["src/Header.tsx"], forbiddenPaths: [".env*"], projectCommands: [], currentProjectFingerprint: hash, currentImplementationHash: hash, previousIterationSummaries: [], designSystemMapping: { artifactId: "mapping", artifactHash: hash, version: "1" }, evidenceOnly: true as const,
};

describe("Visual Correction Agent", () => {
  test("returns an evidence-bound measurable proposal without tools", async () => {
    const output = await deterministicVisualCorrectionStrategy({ agentId: "visual-correction-agent", objective: "Correct the header height", input: { correctionContext: context }, attempt: 1 }, { tools: EMPTY_TOOL_SERVICE, model: EMPTY_MODEL_SERVICE, metadata: {}, signal: new AbortController().signal, logger: { info() {}, warn() {}, error() {}, debug() {} } }, visualCorrectionAgentManifest);
    expect(output.plan.selectedFindingIds).toEqual(["image-difference-desktop"]);
    expect(output.changes[0]?.proposedContent).toContain("96px");
    expect(output.changes[0]?.evidenceIds).toEqual(["implementation-desktop", "reference-desktop"]);
    expect(output.changes[0]?.findingIds).toEqual(["image-difference-desktop"]);
  });

  test("rejects a finding with no supplied excerpt instead of inventing a file", async () => {
    await expect(deterministicVisualCorrectionStrategy({ agentId: "visual-correction-agent", objective: "Correct", input: { correctionContext: { ...context, currentImplementationExcerpts: [] } }, attempt: 1 }, { tools: EMPTY_TOOL_SERVICE, model: EMPTY_MODEL_SERVICE, metadata: {}, signal: new AbortController().signal, logger: { info() {}, warn() {}, error() {}, debug() {} } }, visualCorrectionAgentManifest)).rejects.toThrow();
  });
});
