// apps/designflow-cli/src/commands/interactive.ts
import {
  banner,
  destinationMenu,
  designMenu,
  menu,
  shellHelp,
  type Terminal,
} from "../ui/terminal";
import {
  detectCurrentProject,
  ensureCurrentProject,
} from "../services/current-project";
import {
  findDestinationCandidates,
  type DestinationCandidate,
} from "../services/destinations";
import {
  designFromCurrentSelection,
  designFromUrl,
  type InteractiveDesign,
} from "../services/figma-selection";
import { readyFreshUiState } from "../ui/tui/fresh-ui";
import { retrieveFreshFrameEvidence, freshEvidenceErrorMessage } from "../services/fresh-figma-evidence";

import {
  EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID,
  type CliContext,
} from "../services/cli-runner";
import type { ExecutionProgress } from "@designflow/product";
import type { ApprovalMode, ProjectIdentity, SessionResult } from "@designflow/sdk";
import { runCommand } from "./run";
import type { ProductReviewRequest } from "./session-flow";
import { AuthSessionError } from "../services/auth-session";

export function interactiveRunOptions(
  project: ProjectIdentity | null,
  destination?: DestinationCandidate,
  design?: InteractiveDesign,
): {
  interactive: true;
  offerArtifactView: true;
  productExperience: true;
  projectId?: string;
  destination?: DestinationCandidate;
  design?: InteractiveDesign;
} {
  return {
    interactive: true,
    offerArtifactView: true,
    productExperience: true,
    ...(project !== null ? { projectId: project.id } : {}),
    ...(destination !== undefined ? { destination } : {}),
    ...(design !== undefined ? { design } : {}),
  };
}

export function interactiveRunOptionsForProjectId(
  projectId: string | undefined,
  destination: DestinationCandidate,
  design: InteractiveDesign,
  approvalMode: ApprovalMode = "manual",
): {
  interactive: true;
  offerArtifactView: true;
  productExperience: true;
  projectId?: string;
  destination: DestinationCandidate;
  design: InteractiveDesign;
  approvalMode: ApprovalMode;
} {
  return {
    interactive: true,
    offerArtifactView: true,
    productExperience: true,
    ...(projectId === undefined ? {} : { projectId }),
    destination,
    design,
    approvalMode,
  };
}

function designEngineerWorkerId(context: CliContext): string | null {
  return context.workers
    .listWorkers()
    .find((candidate) => candidate.workflows.includes(EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID))
    ?.id ?? null;
}

export async function runSelectedDesignEngineer(
  context: CliContext,
  terminal: Terminal,
  projectId: string | undefined,
  design: InteractiveDesign,
  destination: DestinationCandidate,
  approvalMode: ApprovalMode = "manual",
  hooks: {
    readonly onProgress?: (progress: ExecutionProgress) => void;
    readonly onSessionResult?: (result: SessionResult) => void;
    readonly onReview?: (request: ProductReviewRequest) => Promise<"approve" | "reject">;
    readonly onAuthRequired?: (message: string) => void;
    /**
     * DF-CORR-01: the TUI owns the Improve decision on its visual-result
     * panel, so it passes "off" here to disable the legacy post-run
     * correction offer/consent prompts. The correction iteration may only be
     * consumed by an explicit Improve (offerVisualCorrection with
     * productAuthorized). Legacy terminals keep the default behavior.
     */
    readonly visualCorrection?: "off" | "once";
  } = {},
): Promise<number> {
  if (context.aiStatus() === "sign-in-required") {
    const message = "Sign in required to start Design Engineer.";
    if (hooks.onAuthRequired !== undefined) hooks.onAuthRequired(message);
    else {
      terminal.print();
      terminal.print(message);
    }
    return 1;
  }
  const workerId = designEngineerWorkerId(context);
  if (workerId === null) {
    terminal.print();
    terminal.print("The design worker is not installed.");
    terminal.print("Run  designflow list  to see the available workers.");
    return 1;
  }

  terminal.print();
  terminal.print("Starting Design Engineer...");
  return runCommand(
    context,
    terminal,
    workerId,
    {
      ...interactiveRunOptionsForProjectId(projectId, destination, design, approvalMode),
      ...(hooks.onProgress === undefined ? {} : { onProgress: hooks.onProgress }),
      ...(hooks.onSessionResult === undefined ? {} : { onSessionResult: hooks.onSessionResult }),
      ...(hooks.onReview === undefined ? {} : { onReview: hooks.onReview }),
      ...(hooks.visualCorrection === undefined ? {} : { visualCorrection: hooks.visualCorrection }),
    },
  );
}

export async function selectDesign(
  context: CliContext,
  terminal: Terminal,
): Promise<InteractiveDesign | null> {
  for (;;) {
    terminal.print(designMenu());
    const answer = (await terminal.ask(
      "Design",
      ["Current Figma selection", "Paste Figma URL", "Back"],
    ))
      .trim()
      .toLowerCase();

    if (answer === "back" || answer === "b" || answer === "q") return null;

    const current =
      answer.length === 0 ||
      answer === "1" ||
      answer === "current" ||
      answer === "current figma selection";
    const paste =
      answer === "2" ||
      answer === "paste" ||
      answer === "paste figma url";

    if (current) {
      if (context.figmaConnectionStatus() !== "connected") {
        terminal.print();
        terminal.print("No Figma selection found.");
        terminal.print("Select a frame in Figma or paste a Figma URL.");
        continue;
      }

      const selection = await context.getCurrentFigmaSelection();
      if (selection === null) {
        terminal.print();
        terminal.print("No Figma selection found.");
        terminal.print("Select a frame in Figma or paste a Figma URL.");
        continue;
      }

      return designFromCurrentSelection(selection);
    }

    if (paste) {
      const raw = await terminal.ask("Figma URL");
      try {
        return designFromUrl(raw);
      } catch {
        terminal.print();
        terminal.print("That is not a valid Figma URL. Try again.");
        continue;
      }
    }

    terminal.print();
    terminal.print("Choose Current Figma selection, Paste Figma URL, or Back.");
  }
}

/** Isolated Phase 1 source picker used by `designflow fresh`. */
export async function freshCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  let failures = 0;
  const reportFailure = (message: string): boolean => {
    failures += 1;
    terminal.print(message);
    if (failures < 3) return false;
    terminal.print("Fresh UI stopped after three invalid or unavailable source attempts.");
    return true;
  };

  for (;;) {
    terminal.print("Fresh UI MVP — choose a Figma frame source.");
    const answer = (await terminal.ask(
      "Source",
      ["Current Figma selection", "Paste Figma frame URL"],
    )).trim().toLowerCase();

    if (answer === "q" || answer === "quit" || answer === "back") return 0;

    if (answer.length === 0 || answer === "1" || answer === "current" || answer === "current figma selection") {
      let selection;
      try {
        const connection = context.figmaConnectionStatus() !== "connected"
          ? await context.ensureFigmaConnection()
          : "connected";
        if (connection !== "connected") {
          if (reportFailure("Figma Desktop is unavailable. Connect Figma Desktop and try again.")) return 1;
          continue;
        }
        selection = await context.getCurrentFigmaSelection();
      } catch {
        if (reportFailure("Figma Desktop is unavailable. Connect Figma Desktop and try again.")) return 1;
        continue;
      }
      if (selection === null) {
        if (reportFailure("No Figma selection found. Select one frame or paste a frame URL.")) return 1;
        continue;
      }
      try {
        const ready = readyFreshUiState(designFromCurrentSelection(selection));
        if (context.retrieveFreshFigmaSnapshot !== undefined && context.compileFreshFigmaEvidence !== undefined) {
          const evidence = await retrieveFreshFrameEvidence({
            source: ready.source,
            nodeId: ready.nodeId,
            sourceKind: "current-selection",
          }, context.retrieveFreshFigmaSnapshot, context.compileFreshFigmaEvidence);
          terminal.print(`Figma evidence ready: ${evidence.frame.name} (${evidence.frame.width} × ${evidence.frame.height})`);
          if (context.scaffoldFreshProject !== undefined) {
            const scaffold = await context.scaffoldFreshProject(evidence);
            terminal.print(`Fresh project created: ${scaffold.targetPath}`);
            if (context.generateFreshProject !== undefined) {
              const generated = await context.generateFreshProject(evidence, scaffold);
              terminal.print(`Fresh UI generated and built: ${generated.targetPath}`);
              if (context.previewFreshProject !== undefined) {
                const preview = await context.previewFreshProject(evidence, scaffold);
                terminal.print(`Fresh preview captured: ${preview.previewUrl} (${preview.viewport.width} × ${preview.viewport.height})`);
              }
            }
          }
        }
        terminal.print(`Ready to generate: ${ready.nodeId}`);
        return 0;
      } catch (error) {
        if (reportFailure(freshEvidenceErrorMessage(error) || "Invalid Figma selection.")) return 1;
        continue;
      }
    }

    if (answer === "2" || answer === "paste" || answer === "paste figma frame url") {
      try {
        const ready = readyFreshUiState(designFromUrl(await terminal.ask("Figma frame URL")));
        if (context.retrieveFreshFigmaSnapshot !== undefined && context.compileFreshFigmaEvidence !== undefined) {
          const evidence = await retrieveFreshFrameEvidence({
            source: ready.source,
            nodeId: ready.nodeId,
            sourceKind: "figma-url",
          }, context.retrieveFreshFigmaSnapshot, context.compileFreshFigmaEvidence);
          terminal.print(`Figma evidence ready: ${evidence.frame.name} (${evidence.frame.width} × ${evidence.frame.height})`);
          if (context.scaffoldFreshProject !== undefined) {
            const scaffold = await context.scaffoldFreshProject(evidence);
            terminal.print(`Fresh project created: ${scaffold.targetPath}`);
            if (context.generateFreshProject !== undefined) {
              const generated = await context.generateFreshProject(evidence, scaffold);
              terminal.print(`Fresh UI generated and built: ${generated.targetPath}`);
              if (context.previewFreshProject !== undefined) {
                const preview = await context.previewFreshProject(evidence, scaffold);
                terminal.print(`Fresh preview captured: ${preview.previewUrl} (${preview.viewport.width} × ${preview.viewport.height})`);
              }
            }
          }
        }
        terminal.print(`Ready to generate: ${ready.nodeId}`);
        return 0;
      } catch (error) {
        if (reportFailure(freshEvidenceErrorMessage(error) || "Invalid Figma source.")) return 1;
        continue;
      }
    }

    if (reportFailure("Choose Current Figma selection or Paste Figma frame URL.")) return 1;
  }
}

export async function selectDestination(
  terminal: Terminal,
  candidates: readonly DestinationCandidate[],
): Promise<DestinationCandidate | null> {
  if (candidates.length === 0) return null;

  terminal.print(destinationMenu(candidates));
  const answer = (await terminal.ask(
    "Destination",
    candidates.map((candidate) => candidate.label),
  ))
    .trim()
    .toLowerCase();

  if (answer.length === 0) return candidates[0] ?? null;

  const numeric = Number.parseInt(answer, 10);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= candidates.length) {
    return candidates[numeric - 1] ?? null;
  }

  return (
    candidates.find((candidate) => candidate.label.toLowerCase() === answer) ?? null
  );
}

export async function signInInteractive(
  context: CliContext,
  terminal: Terminal,
): Promise<boolean> {
  try {
    terminal.print();
    terminal.print("Opening Google sign-in in your browser...");
    await context.signInWithGoogle((url) => {
      terminal.print();
      terminal.print("Could not open your browser automatically.");
      terminal.print();
      terminal.print("Open this sign-in link:");
      terminal.print(url);
    });
  } catch (error) {
    terminal.print();
    terminal.print(error instanceof AuthSessionError ? error.message : "Sign-in is temporarily unavailable.");
    return false;
  }

  terminal.print();
  terminal.print("✓ Signed in");
  return true;
}

/**
 * `designflow` with no arguments — the application shell.
 *
 * The default entry point, and the one a first-time reader sees. It loops so
 * the session is a place to work rather than a single command.
 *
 * Starting the flow deliberately resolves the installed worker from the
 * registry and then calls the same run command used by an explicit invocation.
 * The shell owns presentation only; it does not duplicate workflow behavior.
 */
export async function interactiveCommand(
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  const project = await ensureCurrentProject(
    context,
    detectCurrentProject(),
  );
  await context.refreshAiSession();
  await context.ensureFigmaConnection();
  if (context.signal?.aborted === true) return 130;

  terminal.print(banner());

  let design: InteractiveDesign | null = null;
  let destination: DestinationCandidate | null = null;

  for (;;) {
    terminal.print(
      menu(project, {
        status: context.figmaConnectionStatus(),
        ...(design !== null ? { design: design.label } : {}),
        ...(destination !== null ? { destination: destination.label } : {}),
      }, { status: context.aiStatus() }),
    );

    const choice = (await terminal.ask("Command", ["Enter", "q", "?"]))
      .trim()
      .toLowerCase();

    if (choice === "q" || choice === "quit" || choice === "exit") {
      terminal.print();
      terminal.print("Goodbye.");
      return 0;
    }

    if (choice === "?") {
      terminal.print(shellHelp());
      continue;
    }

    if (
      choice.length === 0 ||
      choice === "start" ||
      choice === "design" ||
      choice === "run"
    ) {
      if (context.aiStatus() === "sign-in-required") {
        await signInInteractive(context, terminal);
        continue;
      }

      if (design === null) {
        design = await selectDesign(context, terminal);
        if (design === null) continue;
      }

      if (destination === null) {
        const destinations = await findDestinationCandidates(context, project);
        destination = await selectDestination(terminal, destinations);
      }
      if (destination === null) {
        terminal.print();
        terminal.print("Choose one of the destinations shown to continue.");
        continue;
      }

      await runSelectedDesignEngineer(context, terminal, project?.id, design, destination);
      continue;
    }

    terminal.print();
    terminal.print(`Not a shell command: ${choice}`);
  }
}
