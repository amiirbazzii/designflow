// apps/designflow-cli/src/cli.ts
import {
  onboarding,
  runExample,
  usage,
  version,
  type Terminal,
} from "./ui/terminal";

import type { CliContext } from "./services/cli-runner";
import { workerDetailCommand, workersCommand } from "./commands/workers";
import { runCommand } from "./commands/run";
import { historyCommand } from "./commands/history";
import { artifactsCommand } from "./commands/artifacts";
import { tracesCommand } from "./commands/traces";
import { freshCommand, interactiveCommand } from "./commands/interactive";
import { settingsCommand } from "./commands/settings";
import {
  answerCommand,
  cancelCommand,
  sessionsCommand,
} from "./commands/sessions";
import { cleanupCommand } from "./commands/cleanup";
import { feedbackLoopCommand } from "./commands/feedback-loop";
import { doctorCommand } from "./commands/doctor";
import { logoutCommand } from "./commands/logout";
import {
  projectsAddCommand,
  projectsCommand,
  projectsInspectCommand,
  projectsShowCommand,
} from "./commands/projects";
import {
  memoryAddCommand,
  memoryApproveCommand,
  memoryCommand,
  memoryProposalsCommand,
  memoryRejectCommand,
  memoryRevokeCommand,
} from "./commands/memory";
import {
  memoryProposalStatusSchema,
  sessionStatusSchema,
} from "@designflow/sdk";
import { CLI_VERSION } from "./version";

export { CLI_VERSION };

/**
 * Argument parsing and dispatch.
 *
 * Hand-rolled rather than delegated to an argument library: there are five
 * commands, and a global `npm install -g designflow` is nicer for having one
 * fewer dependency to audit.
 *
 * Separated from `main.ts` so the whole surface is testable by calling
 * `dispatch(argv, context, terminal)` with no process involved.
 */
export async function dispatch(
  argv: readonly string[],
  context: CliContext,
  terminal: Terminal,
): Promise<number> {
  const [command, ...rest] = argv;

  // Onboarding comes before any command: a fresh install should introduce
  // itself whether the first thing typed is `designflow` or `designflow list`.
  // Shown once — the config records that setup happened.
  //
  // `newInstall`, not `firstRun`: an upgrade from a CLI predating
  // `firstRunCompleted` still has setup work to do, but telling someone it
  // "set up ~/.designflow" would describe work it did not do to a directory
  // they already had.
  if (context.home.newInstall) {
    terminal.print(onboarding(context.home.layout));
  }

  if (command === "--help" || command === "-h" || command === "help") {
    terminal.print(usage());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    terminal.print(version(CLI_VERSION));
    return 0;
  }

  if (command === undefined) {
    return interactiveCommand(context, terminal);
  }

  switch (command) {
    case "fresh":
      return freshCommand(context, terminal);
    case "doctor":
      return doctorCommand(context, terminal, { json: rest.includes("--json") });
    case "feedback-loop": {
      const parentCommand =
        rest[0] === "show" || rest[0] === "resume" || rest[0] === "stop"
          ? rest[0]
          : undefined;
      if (parentCommand !== undefined)
        return feedbackLoopCommand(
          context,
          terminal,
          undefined,
          parentCommand,
          rest[1],
        );
      const inputFlag = rest.indexOf("--input");
      const inputPath = inputFlag >= 0 ? rest[inputFlag + 1] : undefined;
      return feedbackLoopCommand(context, terminal, inputPath);
    }
    // `list` is the original name, kept as an alias.
    case "list":
    case "workers": {
      const workerId = rest[0];
      return workerId !== undefined
        ? workerDetailCommand(context, terminal, workerId)
        : workersCommand(context, terminal);
    }

    case "settings":
      return settingsCommand(context, terminal);

    case "logout":
      return logoutCommand(context, terminal);

    case "cleanup":
      return cleanupCommand(context, terminal);

    case "history": {
      const workflowId = rest[0];
      return historyCommand(
        context,
        terminal,
        workflowId !== undefined ? { workflowId } : undefined,
      );
    }

    case "artifacts": {
      const executionId = rest[0];
      const artifactId = rest[1];

      return artifactsCommand(context, terminal, executionId, artifactId);
    }

    case "traces": {
      const traceId = rest[0];
      return tracesCommand(
        context,
        terminal,
        traceId !== undefined ? { traceId } : undefined,
      );
    }

    case "sessions": {
      const first = rest[0];

      if (first === "--status") {
        const parsed = sessionStatusSchema.safeParse(rest[1]);

        if (!parsed.success) {
          terminal.print(`Unknown status: ${rest[1] ?? ""}`);
          return 1;
        }

        return sessionsCommand(context, terminal, { status: parsed.data });
      }

      return sessionsCommand(
        context,
        terminal,
        first !== undefined ? { sessionId: first } : undefined,
      );
    }

    case "answer": {
      const sessionId = rest[0];

      if (sessionId === undefined) {
        terminal.print("Which session? For example:");
        terminal.print();
        terminal.print("  designflow answer <session-id>");
        terminal.print();
        terminal.print(
          "Run  designflow sessions  to see who is waiting on you.",
        );
        return 1;
      }

      return answerCommand(context, terminal, sessionId);
    }

    case "cancel": {
      const sessionId = rest[0];

      if (sessionId === undefined) {
        terminal.print("Which session? For example:");
        terminal.print();
        terminal.print("  designflow cancel <session-id>");
        return 1;
      }

      return cancelCommand(context, terminal, sessionId);
    }

    case "run": {
      const name = rest[0];

      if (name === undefined) {
        terminal.print("Which worker? For example:");
        terminal.print();
        terminal.print(`  ${runExample(context.workers.listWorkers()[0]?.id)}`);
        terminal.print();
        terminal.print("Run  designflow list  to see who is available.");
        return 1;
      }

      const projectFlagIndex = rest.indexOf("--project");
      const projectId =
        projectFlagIndex >= 0 ? rest[projectFlagIndex + 1] : undefined;
      const visualCorrectionFlags = rest.filter((value) =>
        value.startsWith("--visual-correction="),
      );
      if (visualCorrectionFlags.length > 1) {
        terminal.print("Use --visual-correction=off or --visual-correction=once once.");
        return 1;
      }
      const visualCorrectionValue = visualCorrectionFlags[0]?.split("=", 2)[1];
      if (
        visualCorrectionValue !== undefined &&
        visualCorrectionValue !== "off" &&
        visualCorrectionValue !== "once"
      ) {
        terminal.print("Visual correction must be off or once.");
        return 1;
      }

      return runCommand(
        context,
        terminal,
        name,
        rest.includes("--no-cache")
          ? {
              ...(projectId !== undefined ? { projectId } : {}),
              noCache: true,
              interactive: process.stdin.isTTY === true,
              ...(visualCorrectionValue !== undefined
                ? { visualCorrection: visualCorrectionValue }
                : {}),
            }
          : projectId !== undefined
            ? {
                projectId,
                interactive: process.stdin.isTTY === true,
                ...(visualCorrectionValue !== undefined
                  ? { visualCorrection: visualCorrectionValue }
                  : {}),
              }
            : visualCorrectionValue !== undefined
              ? {
                  interactive: process.stdin.isTTY === true,
                  visualCorrection: visualCorrectionValue,
                }
              : { interactive: process.stdin.isTTY === true },
      );
    }

    case "projects": {
      const sub = rest[0];

      if (sub === undefined) return projectsCommand(context, terminal);

      if (sub === "add") {
        const name = readFlag(rest, "--name");
        const path = readFlag(rest, "--path");
        return projectsAddCommand(context, terminal, {
          ...(name !== undefined ? { name } : {}),
          ...(path !== undefined ? { path } : {}),
          inspect: rest.includes("--inspect"),
        });
      }

      if (sub === "inspect" || sub === "show") {
        const projectId = rest[1];
        if (projectId === undefined) {
          terminal.print(`Which project? For example:`);
          terminal.print();
          terminal.print(`  designflow projects ${sub} <project-id>`);
          terminal.print();
          terminal.print(
            "Run  designflow projects  to see the ones that do exist.",
          );
          return 1;
        }

        return sub === "inspect"
          ? projectsInspectCommand(context, terminal, projectId)
          : projectsShowCommand(context, terminal, projectId);
      }

      terminal.print(`Unknown projects command: ${sub}`);
      return 1;
    }

    case "memory": {
      const sub = rest[0];

      if (sub === undefined) {
        const projectId = readFlag(rest, "--project");
        const agentName = readFlag(rest, "--agent");
        return memoryCommand(context, terminal, {
          ...(projectId !== undefined ? { projectId } : {}),
          ...(agentName !== undefined ? { agentName } : {}),
        });
      }

      if (sub === "add") {
        const scope = readFlag(rest, "--scope");
        const projectId = readFlag(rest, "--project");
        const agentName = readFlag(rest, "--agent");
        const key = readFlag(rest, "--key");
        const value = readFlag(rest, "--value");
        return memoryAddCommand(context, terminal, {
          ...(scope === "project" ||
          scope === "project-agent" ||
          scope === "agent"
            ? { scope }
            : {}),
          ...(projectId !== undefined ? { projectId } : {}),
          ...(agentName !== undefined ? { agentName } : {}),
          ...(key !== undefined ? { key } : {}),
          ...(value !== undefined ? { value } : {}),
        });
      }

      if (sub === "revoke") {
        const memoryId = rest[1];
        if (memoryId === undefined) {
          terminal.print("Which memory? For example:");
          terminal.print();
          terminal.print("  designflow memory revoke <memory-id>");
          return 1;
        }
        return memoryRevokeCommand(context, terminal, memoryId);
      }

      if (sub === "proposals") {
        const statusFlag = readFlag(rest, "--status");
        const parsed =
          statusFlag !== undefined
            ? memoryProposalStatusSchema.safeParse(statusFlag)
            : undefined;

        if (
          statusFlag !== undefined &&
          (parsed === undefined || !parsed.success)
        ) {
          terminal.print(`Unknown status: ${statusFlag}`);
          return 1;
        }

        return memoryProposalsCommand(
          context,
          terminal,
          parsed?.success === true ? { status: parsed.data } : undefined,
        );
      }

      if (sub === "approve" || sub === "reject") {
        const proposalId = rest[1];
        if (proposalId === undefined) {
          terminal.print("Which proposal? For example:");
          terminal.print();
          terminal.print(`  designflow memory ${sub} <proposal-id>`);
          terminal.print();
          terminal.print(
            "Run  designflow memory proposals  to see what is waiting.",
          );
          return 1;
        }

        return sub === "approve"
          ? memoryApproveCommand(context, terminal, proposalId)
          : memoryRejectCommand(context, terminal, proposalId);
      }

      terminal.print(`Unknown memory command: ${sub}`);
      return 1;
    }

    default:
      terminal.print(`Unknown command: ${command}`);
      terminal.print();
      terminal.print(usage());
      return 1;
  }
}

/** `--flag value` anywhere in the remaining args, or `undefined` if absent. */
function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
