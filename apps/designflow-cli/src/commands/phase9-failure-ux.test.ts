// apps/designflow-cli/src/commands/phase9-failure-ux.test.ts
import { describe, expect, test } from "bun:test";
import { designEngineer } from "@designflow/workers";
import type { CliContext, ResolvedWorker } from "../services/cli-runner";
import { designFromCurrentSelection, type InteractiveDesign } from "../services/figma-selection";
import { ScriptedTerminal } from "../ui/terminal";
import { interactiveRunOptions } from "./interactive";
import { runCommand } from "./run";

/**
 * Phase 9 failure UX, end to end through `runCommand`: the curated failure
 * screen, the optional technical-details prompt, and the distinct product
 * outcomes for cancellation and rejection.
 */

const project = {
  id: "project-1",
  name: "Spendly",
  rootPath: "/tmp/phase9-does-not-exist",
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
  readonly overview: Record<string, unknown>;
  readonly artifacts?: Array<{ artifactId: string; name?: string }>;
  readonly validationPayload?: Record<string, unknown>;
}): CliContext {
  const artifacts = (options.artifacts ?? []).map((artifact) => ({
    artifactId: artifact.artifactId,
    name: artifact.name ?? artifact.artifactId,
  }));
  return {
    refreshAiSession: async () => "connected",
    resolve: () => resolved,
    onProgress: () => undefined,
    figmaSourceMode: "mcp-desktop",
    figmaServerIdentity: "figma-desktop",
    home: { layout: { home: "/tmp/designflow-phase9" } },
    projects: { getProject: async () => project },
    sessions: {
      startSessionForWorker: async (_worker: unknown, request: { input?: unknown }) => ({
        session: { status: "completed", executionId: "execution-9", originalInput: request.input },
      }),
    },
    artifactInspection: {
      getMetadata: async () => undefined,
      getPayload: async () => ({ payload: options.validationPayload ?? {} }),
    },
    runner: {
      pendingApproval: async () => null,
      explain: async () => ({ overview: options.overview, artifacts }),
    },
  } as unknown as CliContext;
}

function runOptions() {
  return { ...interactiveRunOptions(project, destination, design), visualCorrection: "off" as const };
}

const EXHAUSTED_OVERVIEW = {
  state: "failed",
  status: "failed",
  failure: {
    errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
    failedCapabilityId: "invoke-implementation-agent",
    attemptDiagnostics: [
      { attempt: 1, code: "ERR_PROPOSAL_MODULE_COMPILE_FAILED", message: "does not compile", path: "src/pages/NewPage.jsx", compileErrorSummary: 'Could not resolve "../components/Button"' },
      { attempt: 2, code: "ERR_PROPOSAL_MODULE_COMPILE_FAILED", message: "does not compile", path: "src/pages/NewPage.jsx", compileErrorSummary: 'Could not resolve "../components/Button"' },
      { attempt: 3, code: "ERR_PROPOSAL_MODULE_COMPILE_FAILED", message: "does not compile", path: "src/components/Button.jsx", compileErrorSummary: 'Missing dependency "prop-types"' },
    ],
  },
};

describe("Phase 9 failure UX", () => {
  test("an exhausted proposal renders curated attempts and offers technical details", async () => {
    const terminal = new ScriptedTerminal(["yes"]);
    const context = contextFor({ overview: EXHAUSTED_OVERVIEW });

    const code = await runCommand(context, terminal, "design-engineer", runOptions());

    expect(code).toBe(1);
    const transcript = terminal.transcript;
    expect(transcript).toContain("Implementation could not produce a safe change.");
    expect(transcript).toContain("Attempt 1");
    expect(transcript).toContain("Attempt 3");
    expect(transcript).toContain("Build check failed");
    expect(transcript).toContain("No files were changed.");
    expect(terminal.questions).toContain("View technical details?");
    expect(transcript).toContain("Error code: ERR_PROPOSAL_ATTEMPTS_EXHAUSTED");
    expect(transcript).toContain("Run id: execution-9");
  });

  test("declining details keeps the technical facts hidden", async () => {
    const terminal = new ScriptedTerminal(["no"]);
    const context = contextFor({ overview: EXHAUSTED_OVERVIEW });
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).not.toContain("Error code:");
    expect(terminal.transcript).not.toContain("execution-9");
  });

  test("apply success with a later auth failure truthfully reports applied changes", async () => {
    const terminal = new ScriptedTerminal(["no"]);
    const context = contextFor({
      overview: {
        state: "failed",
        status: "failed",
        failure: { errorCode: "ERR_MODEL_AUTHENTICATION", failedCapabilityId: "invoke-visual-validation-agent-stage5" },
      },
      artifacts: [
        { artifactId: "project-snapshot" },
        { artifactId: "file-application-result" },
        { artifactId: "implementation-validation" },
      ],
      validationPayload: { checks: [{ status: "passed" }], rollbackTriggered: false },
    });

    await runCommand(context, terminal, "design-engineer", runOptions());

    const transcript = terminal.transcript;
    expect(transcript).toContain("AI session expired.");
    expect(transcript).toContain("already applied successfully");
    expect(transcript).toContain("applied and remain in place");
    expect(transcript).not.toContain("No files were changed.");
    expect(transcript).toContain("Sign in again from the menu");
  });

  test("cancellation stays a distinct product outcome", async () => {
    const terminal = new ScriptedTerminal([]);
    const context = contextFor({ overview: { state: "failed", status: "cancelled" } });
    await runCommand(context, terminal, "design-engineer", runOptions());
    expect(terminal.transcript).toContain("Cancelled");
    expect(terminal.transcript).not.toContain("could not produce");
  });

  test("waiting for approval is not rendered as a failure", async () => {
    const context = {
      ...contextFor({ overview: { state: "failed", status: "rejected" } }),
    } as unknown as CliContext & { runner: { pendingApproval: () => Promise<unknown> } };
    (context as unknown as { runner: Record<string, unknown> }).runner = {
      pendingApproval: async () => ({ workflowId: "other", reason: "review" }),
      reject: async () => ({ message: "The proposal was rejected." }),
      approve: async () => ({ message: "approved" }),
      explain: async () => ({ overview: { state: "failed", status: "rejected" }, artifacts: [] }),
    };

    const terminal2 = new ScriptedTerminal(["reject"]);
    await runCommand(context, terminal2, "design-engineer", runOptions());
    expect(terminal2.transcript).toContain("Approval required");
    expect(terminal2.transcript).not.toContain("could not produce");
    expect(terminal2.transcript).toContain("Changes rejected");
  });
});
