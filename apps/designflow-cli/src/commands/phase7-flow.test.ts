import { describe, expect, test } from "bun:test";
import { designEngineer } from "@designflow/workers";
import type { CliContext, ResolvedWorker } from "../services/cli-runner";
import { designFromCurrentSelection, type InteractiveDesign } from "../services/figma-selection";
import { ScriptedTerminal } from "../ui/terminal";
import { interactiveRunOptions } from "./interactive";
import { buildInteractiveImplementationInput, collectInput, runCommand } from "./run";

const project = {
  id: "project-1",
  name: "Spendly",
  rootPath: "/tmp/spendly",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
} as const;

const design: InteractiveDesign = designFromCurrentSelection({
  id: "10:1",
  name: "Expense Form",
  type: "FRAME",
});

const destination = {
  label: "/expenses",
  kind: "page" as const,
  path: "/expenses",
  sourcePath: "src/pages/expenses.tsx",
};

const resolved: ResolvedWorker = {
  worker: designEngineer,
  workflowId: "design-to-code-figma-specification",
  workflowInstalled: true,
  steps: 1,
};

function contextFor(options: {
  readonly pendingApproval?: unknown;
  readonly onStarted: (request: Record<string, unknown>) => void;
  readonly onRejected?: () => void;
}): CliContext {
  const runner = {
    pendingApproval: async () => options.pendingApproval ?? null,
    reject: async () => {
      options.onRejected?.();
      return { message: "The proposal was rejected." };
    },
    explain: async () => ({ overview: { state: "ready", status: "completed" }, artifacts: [] }),
  };

  return {
    refreshAiSession: async () => "connected",
    resolve: () => resolved,
    onProgress: () => undefined,
    figmaSourceMode: "mcp-desktop",
    figmaServerIdentity: "figma-desktop",
    home: { layout: { home: "/tmp/designflow-phase7" } },
    projects: { getProject: async () => project },
    sessions: {
      // V2-8: the deterministic dispatch delegates to the same stub.
      startDeterministicSession(worker: unknown, request: never) {
        return (this as unknown as { startSessionForWorker: (w: unknown, r: never) => unknown }).startSessionForWorker(worker, request);
      },
      startSessionForWorker: async (_worker: unknown, request: { input?: unknown; request: string }) => {
        options.onStarted({ request: request.request, input: request.input });
        return {
          session: {
            status: "completed",
            executionId: "execution-1",
            originalInput: request.input,
          },
        };
      },
    },
    runner,
  } as unknown as CliContext;
}

describe("Phase 7 two-decision product flow", () => {
  test("synthesizes implementation intent and destination evidence", () => {
    const input = buildInteractiveImplementationInput(design, destination);

    expect(input).toMatchObject({
      designFile: design.designFile,
      frames: ["Expense Form"],
      destination,
    });
    expect(input.request).toContain("Implement the selected design at /expenses");
    expect(input.request).toContain("Do not modify the project without exact proposal approval");
    expect(input).not.toHaveProperty("projectWriteConsent");
  });

  test("bare product execution starts after design and destination without extra prompts", async () => {
    const started: Record<string, unknown>[] = [];
    const terminal = new ScriptedTerminal();
    const context = contextFor({ onStarted: (request) => started.push(request) });

    const result = await runCommand(
      context,
      terminal,
      "design-engineer",
      { ...interactiveRunOptions(project, destination, design), visualCorrection: "off" },
    );

    expect(result).toBe(0);
    expect(terminal.questions).toEqual([]);
    expect(started).toHaveLength(1);
    // V2-8: the flagship input carries the two product decisions plus the
    // registered project; the legacy intent/consent flags are gone with the
    // legacy dispatch.
    expect(started[0]?.input).toMatchObject({
      project: { id: project.id, name: project.name, rootPath: project.rootPath },
      destination: { ...destination },
      designFile: design.designFile,
    });
    expect(started[0]?.input).not.toHaveProperty("projectWriteConsent");
    expect(started[0]?.input).not.toHaveProperty("implementationIntent");
    expect(String(started[0]?.request)).toContain("Implement the selected design");
  });

  test("exact proposal approval remains a required later decision", async () => {
    let rejected = 0;
    const terminal = new ScriptedTerminal(["reject"]);
    const context = contextFor({
      pendingApproval: { workflowId: "other", reason: "exact proposal review" },
      onStarted: () => undefined,
      onRejected: () => { rejected += 1; },
    });

    const result = await runCommand(
      context,
      terminal,
      "design-engineer",
      { ...interactiveRunOptions(project, destination, design), visualCorrection: "off" },
    );

    expect(result).toBe(1);
    expect(terminal.questions).toEqual(["Approve?"]);
    expect(rejected).toBe(1);
  });

  test("explicit run input still retains the generic intent prompt", async () => {
    const explicitResolved = resolved;
    const terminal = new ScriptedTerminal(["prepare the implementation"]);
    const input = await collectInput(terminal, explicitResolved, design);

    expect(input.request).toBe("prepare the implementation");
    expect(terminal.questions[0]).toContain("What would you like from this design?");
  });
});
