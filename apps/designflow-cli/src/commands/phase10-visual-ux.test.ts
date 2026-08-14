// apps/designflow-cli/src/commands/phase10-visual-ux.test.ts
import { describe, expect, test } from "bun:test";
import { designEngineer } from "@designflow/workers";
import type { CliContext, ResolvedWorker } from "../services/cli-runner";
import { designFromCurrentSelection, type InteractiveDesign } from "../services/figma-selection";
import { ScriptedTerminal } from "../ui/terminal";
import { interactiveRunOptions } from "./interactive";
import { runCommand } from "./run";

/**
 * Phase 10 post-apply visual-result UX through `runCommand`. Correction
 * eligibility here resolves through the real `prepareVisualCorrection`
 * against mocked artifacts, which is deliberately "unavailable" — so these
 * tests also prove Improve is not offered when the deterministic host has
 * not authorized correction.
 */

const project = {
  id: "project-1",
  name: "Spendly",
  rootPath: "/tmp/phase10-does-not-exist",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
} as const;

const design: InteractiveDesign = designFromCurrentSelection({ id: "10:1", name: "Expense Form", type: "FRAME" });
const destination = { label: "New page", kind: "new-page" as const };

const resolved: ResolvedWorker = {
  worker: designEngineer,
  workflowId: "design-to-code-figma-specification",
  workflowInstalled: true,
  steps: 1,
};

function contextFor(options: {
  readonly payloads: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, Record<string, unknown>>>;
}): CliContext {
  const artifacts = Object.keys(options.payloads).map((artifactId) => ({ artifactId, name: artifactId }));
  return {
    refreshAiSession: async () => "connected",
    resolve: () => resolved,
    onProgress: () => undefined,
    figmaSourceMode: "mcp-desktop",
    figmaServerIdentity: "figma-desktop",
    home: { layout: { home: "/tmp/designflow-phase10" } },
    projects: { getProject: async () => project },
    roleModelProfiles: [],
    artifactStore: { get: async () => null, save: async () => ({ id: "x" }), exists: async () => false },
    feedbackLoopParents: { get: async () => null, list: async () => [] },
    listWorkflows: () => [],
    sessions: {
      // V2-8: the deterministic dispatch delegates to the same stub.
      startDeterministicSession(worker: unknown, request: never) {
        return (this as unknown as { startSessionForWorker: (w: unknown, r: never) => unknown }).startSessionForWorker(worker, request);
      },
      startSessionForWorker: async (_worker: unknown, request: { input?: unknown }) => ({
        session: { status: "completed", executionId: "execution-10", originalInput: request.input },
      }),
    },
    artifactInspection: {
      getMetadata: async (artifactId: string) => options.metadata?.[artifactId],
      getPayload: async (summary: { artifactId: string }) => ({ payload: options.payloads[summary.artifactId] }),
    },
    runner: {
      pendingApproval: async () => null,
      explain: async () => ({ overview: { state: "ready", status: "completed" }, artifacts }),
    },
  } as unknown as CliContext;
}

const APPLIED_BASE: Record<string, unknown> = {
  "file-application-result": { schemaVersion: "1" },
  "project-snapshot": { schemaVersion: "1" },
  "implementation-validation": { checks: [{ status: "passed" }], rollbackTriggered: false },
  "preview-runtime-record": { status: "ready" },
  "implementation-screenshot-evidence": { schemaVersion: "1" },
};

function runOptions() {
  return { ...interactiveRunOptions(project, destination, design), visualCorrection: undefined as never };
}

describe("Phase 10 post-apply visual result UX", () => {
  test("a successful apply flows into Checking and the visual result", async () => {
    const terminal = new ScriptedTerminal(["Finish"]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "pass", referenceMode: "real-reference", critical: 0, major: 0, minor: 0 },
      },
    });

    const code = await runCommand(context, terminal, "design-engineer", runOptions());

    expect(code).toBe(0);
    const transcript = terminal.transcript;
    expect(transcript).toContain("Applying");
    expect(transcript).toContain("✓ Snapshot created");
    expect(transcript).toContain("✓ Changes applied");
    expect(transcript).toContain("Checking");
    expect(transcript).toContain("✓ Preview opened");
    expect(transcript).toContain("✓ Implementation captured");
    expect(transcript).toContain("✓ Compared with design");
    expect(transcript).toContain("Visual result");
    expect(transcript).toContain("Looks good");
    expect(transcript).not.toContain("Improve");
  });

  test("Finish accepts the applied state and performs nothing further", async () => {
    const terminal = new ScriptedTerminal(["Finish"]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "pass", referenceMode: "real-reference" },
      },
    });
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).toContain("Finished. Your approved changes remain in place.");
  });

  test("findings without host correction eligibility never offer Improve", async () => {
    const terminal = new ScriptedTerminal(["Finish"]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "fail", referenceMode: "real-reference", critical: 1, major: 1, minor: 0 },
        "visual-validation-report": { findings: [{ explanation: "Main content does not match the selected frame" }] },
      },
    });

    await runCommand(context, terminal, "design-engineer", runOptions());

    const transcript = terminal.transcript;
    expect(transcript).toContain("Main content does not match");
    expect(terminal.questions.filter((question) => question === "Visual result")).toHaveLength(1);
    expect(transcript).not.toContain("Improve");
    expect(transcript).toContain("none can be corrected automatically");
  });

  test("inconclusive validation shows a truthful result without Improve", async () => {
    const terminal = new ScriptedTerminal(["Finish"]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "inconclusive", referenceMode: "insufficient-reference" },
      },
    });
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).toContain("inconclusive");
    expect(terminal.transcript).not.toContain("Improve /");
  });

  test("missing comparison evidence never pretends success", async () => {
    const terminal = new ScriptedTerminal(["Finish"]);
    const context = contextFor({ payloads: { ...APPLIED_BASE } });
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).toContain("Visual comparison could not complete");
    expect(terminal.transcript).not.toContain("Looks good");
  });

  test("deterministic reachability evidence is surfaced on the result", async () => {
    const terminal = new ScriptedTerminal(["Finish"]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "fail", referenceMode: "real-reference" },
      },
      metadata: {
        "proposed-file-changes": { moduleValidation: "passed", unreachableChangedFiles: 1, reachableChangedFiles: 4 },
      },
    });
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).toContain("not connected to the rendered application");
  });

  test("reachability persisted as file lists (the live workflow shape) is surfaced too", async () => {
    const terminal = new ScriptedTerminal(["Finish"]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "fail", referenceMode: "real-reference" },
      },
      metadata: {
        "proposed-file-changes": {
          moduleValidation: "passed",
          unreachableChangedFiles: ["src/components/Button.jsx", "src/components/Button.css"],
          reachableChangedFiles: [],
        },
      },
    });
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).toContain("not connected to the rendered application");
  });

  test("Details exposes bounded metrics and eligibility, never artifact internals", async () => {
    const terminal = new ScriptedTerminal(["Details", "Finish"]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "fail", referenceMode: "real-reference", critical: 1, major: 0, minor: 2 },
        "image-comparison-metrics": {
          viewportResults: [
            { viewport: { id: "desktop" }, status: "fail", metrics: { pixelMismatchRatio: 0.123, overlapCoverage: 0.8 } },
          ],
        },
      },
    });
    await runCommand(context, terminal, "design-engineer", runOptions());
    const transcript = terminal.transcript;
    expect(transcript).toContain("desktop: fail  ·  mismatch 12.3%  ·  overlap 80%");
    expect(transcript).toContain("Correction eligibility:");
    const details = transcript.split("Details")[2] ?? transcript;
    expect(details).not.toContain("payloadId");
    expect(details).not.toContain("artifactId");
  });
});

describe("DF-CORR-01 the TUI product path never auto-starts a correction", () => {
  test("visualCorrection 'off' skips the legacy visual-result and correction consent prompts entirely", async () => {
    // No scripted answers on purpose: if any legacy ask fires, the scripted
    // terminal would record the question in the transcript.
    const terminal = new ScriptedTerminal([]);
    const context = contextFor({
      payloads: {
        ...APPLIED_BASE,
        "stage-5-summary": { overallStatus: "needs_improvement", referenceMode: "real-reference", critical: 0, major: 1, minor: 0 },
      },
    });

    const code = await runCommand(context, terminal, "design-engineer", {
      ...runOptions(),
      visualCorrection: "off",
    });

    expect(code).toBe(0);
    const transcript = terminal.transcript;
    expect(transcript).not.toContain("Visual result [");
    expect(transcript).not.toContain("Start a correction iteration?");
    expect(transcript).not.toContain("Approve these exact correction changes?");
  });
});
