// apps/designflow-cli/src/commands/phase8-review.test.ts
import { describe, expect, test } from "bun:test";
import { designEngineer } from "@designflow/workers";
import { EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID, type CliContext, type ResolvedWorker } from "../services/cli-runner";
import { designFromCurrentSelection, type InteractiveDesign } from "../services/figma-selection";
import { ScriptedTerminal } from "../ui/terminal";
import { interactiveRunOptions } from "./interactive";
import { runCommand } from "./run";

/**
 * Phase 8 integrated review UX, driven end-to-end through `runCommand`
 * against a scripted terminal and a mocked runner. The proposal payload
 * below is the single authoritative source both for what the review
 * displays and for what approve/reject bind to — exactly the invariant
 * the product layer must preserve.
 */

const project = {
  id: "project-1",
  name: "Spendly",
  rootPath: "/tmp/phase8-does-not-exist",
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

const PROPOSAL_PAYLOAD = {
  schemaVersion: "1",
  projectId: "project-1",
  baseProjectFingerprint: "fp-1",
  files: [
    { path: "src/pages/NewPage.jsx", action: "create", content: "export default function NewPage() {\n  return null;\n}\n", reason: "New page." },
    { path: "src/components/Button.jsx", action: "create", content: "export default function Button() {\n  return null;\n}\n", reason: "Button." },
  ],
  packageChanges: [],
  commandsRequested: [],
  assumptions: [],
  unresolvedItems: [],
};

function contextFor(options: {
  readonly withProposal?: boolean;
  readonly onApproved?: () => void;
  readonly onRejected?: () => void;
}): CliContext {
  const artifacts = options.withProposal === false
    ? []
    : [
        { artifactId: "proposed-file-changes", name: "Proposed File Changes" },
        { artifactId: "proposed-module-validation", name: "Proposed Module Validation" },
      ];

  const runner = {
    pendingApproval: async () => ({ workflowId: EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID, reason: "exact proposal review" }),
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
    home: { layout: { home: "/tmp/designflow-phase8" } },
    projects: { getProject: async () => project },
    sessions: {
      startSessionForWorker: async (_worker: unknown, request: { input?: unknown }) => ({
        session: { status: "completed", executionId: "execution-1", originalInput: request.input },
      }),
    },
    artifactInspection: {
      getMetadata: async (artifactId: string) =>
        artifactId === "proposed-file-changes" && options.withProposal !== false
          ? { name: "Proposed File Changes", moduleValidation: "passed" }
          : undefined,
      getPayload: async (summary: { artifactId: string }) => ({
        payload:
          summary.artifactId === "proposed-file-changes"
            ? PROPOSAL_PAYLOAD
            : { schemaVersion: "1", status: "passed", validatedFiles: ["src/pages/NewPage.jsx"], diagnostics: [] },
      }),
    },
    runner,
  } as unknown as CliContext;
}

function runOptions() {
  return { ...interactiveRunOptions(project, destination, design), visualCorrection: "off" as const };
}

describe("Phase 8 integrated review UX", () => {
  test("a valid proposal reaches Ready to apply with correct counts and truthful checks", async () => {
    let rejected = 0;
    const terminal = new ScriptedTerminal(["Reject"]);
    const context = contextFor({ onRejected: () => { rejected += 1; } });

    const code = await runCommand(context, terminal, "design-engineer", runOptions());

    expect(code).toBe(1);
    const transcript = terminal.transcript;
    expect(transcript).toContain("Ready to apply");
    expect(transcript).toContain("2 files changed");
    expect(transcript).toContain("+6  -0");
    expect(transcript).toContain("src/pages/NewPage.jsx");
    expect(transcript).toContain("✓ Safe paths");
    expect(transcript).toContain("✓ Proposal validated");
    expect(transcript).toContain("✓ Build checked");
    // Snapshot happens only after approval — never promised on this screen.
    expect(transcript).not.toContain("Snapshot ready");
    expect(rejected).toBe(1);
  });

  test("internal hashes and artifact identifiers stay hidden from the review screen", async () => {
    const terminal = new ScriptedTerminal(["Reject"]);
    const context = contextFor({});
    await runCommand(context, terminal, "design-engineer", runOptions());
    const review = terminal.transcript.split("Ready to apply")[1]!.split("Review")[0]!;
    for (const forbidden of ["fp-1", "proposalHash", "payloadId", "artifactId", "execution-1", EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID]) {
      expect(review).not.toContain(forbidden);
    }
  });

  test("View diff shows the exact proposed content and does not approve", async () => {
    let approved = 0;
    let rejected = 0;
    const terminal = new ScriptedTerminal(["View diff", "src/pages/NewPage.jsx", "Back", "Reject"]);
    const context = contextFor({ onApproved: () => { approved += 1; }, onRejected: () => { rejected += 1; } });

    await runCommand(context, terminal, "design-engineer", runOptions());

    const transcript = terminal.transcript;
    expect(transcript).toContain("Files");
    expect(transcript).toContain("+3 -0");
    expect(transcript).toContain("+ export default function NewPage() {");
    expect(approved).toBe(0);
    expect(rejected).toBe(1);
  });

  test("returning from the diff shows the same proposal again", async () => {
    const terminal = new ScriptedTerminal(["View diff", "Back", "Reject"]);
    const context = contextFor({});
    await runCommand(context, terminal, "design-engineer", runOptions());
    const occurrences = terminal.transcript.split("Ready to apply").length - 1;
    expect(occurrences).toBe(2);
    const counts = terminal.transcript.split("2 files changed").length - 1;
    expect(counts).toBe(2);
  });

  test("Apply requires the explicit confirmation and invokes the existing approval path", async () => {
    let approved = 0;
    const terminal = new ScriptedTerminal(["Apply", "yes"]);
    const context = contextFor({ onApproved: () => { approved += 1; } });

    await runCommand(context, terminal, "design-engineer", runOptions());

    expect(terminal.questions).toContain("Apply these exact changes?");
    expect(approved).toBe(1);
  });

  test("declining the confirmation returns to review without approving", async () => {
    let approved = 0;
    let rejected = 0;
    const terminal = new ScriptedTerminal(["Apply", "no", "Reject"]);
    const context = contextFor({ onApproved: () => { approved += 1; }, onRejected: () => { rejected += 1; } });

    await runCommand(context, terminal, "design-engineer", runOptions());

    expect(approved).toBe(0);
    expect(rejected).toBe(1);
  });

  test("rejection renders the product outcome and writes nothing", async () => {
    const terminal = new ScriptedTerminal(["Reject"]);
    const context = contextFor({});
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).toContain("Changes rejected");
    expect(terminal.transcript).toContain("No files were changed.");
  });

  test("without a stored proposal the legacy prompt is used and Apply is never offered", async () => {
    let rejected = 0;
    const terminal = new ScriptedTerminal(["reject"]);
    const context = contextFor({ withProposal: false, onRejected: () => { rejected += 1; } });

    await runCommand(context, terminal, "design-engineer", runOptions());

    expect(terminal.transcript).not.toContain("Ready to apply");
    expect(terminal.questions).toContain("Approve?");
    expect(terminal.questions).not.toContain("Review");
    expect(rejected).toBe(1);
  });
});
