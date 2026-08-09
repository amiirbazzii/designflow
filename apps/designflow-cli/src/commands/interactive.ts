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

import {
  EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID,
  type CliContext,
} from "../services/cli-runner";
import type { ProjectIdentity } from "@designflow/sdk";
import { runCommand } from "./run";

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
      }),
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
      const worker = context.workers
        .listWorkers()
        .find((candidate) =>
          candidate.workflows.includes(EXPERIMENTAL_IMPLEMENTATION_WORKFLOW_ID),
        );

      if (worker === undefined) {
        terminal.print();
        terminal.print("The design worker is not installed.");
        terminal.print("Run  designflow list  to see the available workers.");
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

      terminal.print();
      terminal.print("Starting Design Engineer...");
      await runCommand(
        context,
        terminal,
        worker.id,
        interactiveRunOptions(project, destination, design),
      );
      continue;
    }

    terminal.print();
    terminal.print(`Not a shell command: ${choice}`);
  }
}
