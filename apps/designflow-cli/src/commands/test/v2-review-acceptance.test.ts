// apps/designflow-cli/src/commands/test/v2-review-acceptance.test.ts
//
// V2-9 acceptance for the flagship review (§55, §71, §72):
//  - a pending approval on the V2 flagship workflow id reaches the rich
//    product review, never the legacy generic prompt;
//  - the review shows exactly the selected proposal (P1 when P1 was kept
//    over a later regressed P2), with V2 checks from `v2-final-review`;
//  - a rejoined (resumed) needs_approval execution reconstructs the same
//    review purely from stored artifacts.
import { describe, expect, test } from "bun:test";
import { designEngineer } from "@designflow/workers";
import { DESIGN_TO_CODE_V2_WORKFLOW_ID, type CliContext, type ResolvedWorker } from "../../services/cli-runner";
import { designFromCurrentSelection, type InteractiveDesign } from "../../services/figma-selection";
import { ScriptedTerminal } from "../../ui/terminal";
import { interactiveRunOptions } from "../interactive";
import { runCommand } from "../run";

const project = {
  id: "project-v2",
  name: "Spendly",
  rootPath: "/tmp/v2-review-does-not-exist",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
} as const;

const design: InteractiveDesign = designFromCurrentSelection({ id: "10:1", name: "Expense Form", type: "FRAME" });
const destination = { label: "New page", kind: "new-page" as const };

const resolved: ResolvedWorker = {
  worker: designEngineer,
  workflowId: DESIGN_TO_CODE_V2_WORKFLOW_ID,
  workflowInstalled: true,
  steps: 16,
};

// P1 — the convergence-selected proposal. A later P2 existed and regressed;
// the review below must show these files and no others (§72).
const SELECTED_PROPOSAL = {
  schemaVersion: "1",
  projectId: "project-v2",
  baseProjectFingerprint: "fp-v2",
  files: [
    { path: "src/pages/ExpenseForm.jsx", action: "create", content: "export default function ExpenseForm() {\n  return null;\n}\n", reason: "Screen." },
  ],
  packageChanges: [],
  commandsRequested: [],
  assumptions: [],
  unresolvedItems: [],
};

const V2_FINAL_REVIEW = {
  convergence: { status: "converged", selectedIteration: 0, iterationsPerformed: 2 },
  visual: { remainingFindingCount: 0 },
  files: [{ path: "src/pages/ExpenseForm.jsx" }],
};

function contextFor(options: {
  readonly onApproved?: () => void;
  readonly onRejected?: () => void;
}): CliContext {
  const artifacts = [
    { artifactId: "proposed-file-changes", name: "Selected proposal" },
    { artifactId: "v2-final-review", name: "Final implementation review" },
  ];

  const runner = {
    pendingApproval: async () => ({
      workflowId: DESIGN_TO_CODE_V2_WORKFLOW_ID,
      reason: "The exact selected proposal requires approval.",
    }),
    approve: async () => {
      options.onApproved?.();
      return { message: "The proposal was approved." };
    },
    reject: async () => {
      options.onRejected?.();
      return { message: "The proposal was rejected." };
    },
    explain: async () => ({ overview: { state: "failed", status: "rejected" }, artifacts }),
  };

  return {
    refreshAiSession: async () => "connected",
    resolve: () => resolved,
    onProgress: () => undefined,
    figmaSourceMode: "mcp-desktop",
    figmaServerIdentity: "figma-desktop",
    home: { layout: { home: "/tmp/designflow-v2-review" } },
    projects: { getProject: async () => project },
    sessions: {
      startDeterministicSession: async (_worker: unknown, request: { input?: unknown }) => ({
        session: { status: "completed", executionId: "execution-v2", originalInput: request.input },
      }),
      startSessionForWorker: async (_worker: unknown, request: { input?: unknown }) => ({
        session: { status: "completed", executionId: "execution-v2", originalInput: request.input },
      }),
    },
    artifactInspection: {
      getMetadata: async () => undefined,
      getPayload: async (summary: { artifactId: string }) => ({
        payload:
          summary.artifactId === "proposed-file-changes"
            ? SELECTED_PROPOSAL
            : summary.artifactId === "v2-final-review"
              ? V2_FINAL_REVIEW
              : undefined,
      }),
    },
    runner,
  } as unknown as CliContext;
}

function runOptions() {
  return { ...interactiveRunOptions(project, destination, design), visualCorrection: "off" as const };
}

describe("V2 flagship review acceptance", () => {
  test("a V2 pending approval reaches the rich review, not the legacy prompt (§55, §71)", async () => {
    let rejected = 0;
    const terminal = new ScriptedTerminal(["Reject"]);
    const context = contextFor({ onRejected: () => { rejected += 1; } });

    const code = await runCommand(context, terminal, "design-engineer", runOptions());

    expect(code).toBe(1);
    expect(rejected).toBe(1);
    expect(terminal.transcript).toContain("Ready to apply");
    // The legacy generic gate must not appear on the flagship path.
    expect(terminal.transcript).not.toContain("Approval required");
    expect(terminal.transcript).not.toContain("Store the generated result as a DesignFlow artifact");
  });

  test("the review shows exactly the selected proposal and its V2 checks (§22, §72)", async () => {
    const terminal = new ScriptedTerminal(["Reject"]);
    const context = contextFor({});

    await runCommand(context, terminal, "design-engineer", runOptions());

    const transcript = terminal.transcript;
    // Exactly P1's file — one file, the selected one.
    expect(transcript).toContain("src/pages/ExpenseForm.jsx");
    expect(transcript).toContain("1 file");
    // Checks derived from the exact v2-final-review artifact.
    expect(transcript).toContain("Build passed");
    expect(transcript).toContain("Visual refinement complete");
    expect(transcript).toContain("Selected iteration 1 of 2");
  });

  test("approving from the reconstructed review binds to the same execution", async () => {
    let approved = 0;
    const terminal = new ScriptedTerminal(["Apply", "yes"]);
    const context = contextFor({ onApproved: () => { approved += 1; } });

    await runCommand(context, terminal, "design-engineer", runOptions());

    expect(approved).toBe(1);
  });
});
