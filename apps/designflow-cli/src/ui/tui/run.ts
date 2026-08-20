import React from "react";
import { render } from "ink";
import { App, type TuiAction, type TuiMode, type TuiSelectionHandlers } from "./app";
import { buildFreshUiViewFromContext, buildSessionRuntimeFromContext, type DesignFlowSessionView } from "./model";
import type { CliContext } from "../../services/cli-runner";
import {
  designFromCurrentSelection,
  designFromUrl,
} from "../../services/figma-selection";
import { findDestinationCandidates } from "../../services/destinations";
import type { TuiExecutionBridge } from "./execution";
import type { TuiArtifactReader } from "./artifact-viewer";
import type { TuiAuthController } from "./auth";

export type TuiStartHandler = (
  action: Extract<TuiAction, { readonly type: "start" }>,
  bridge: TuiExecutionBridge,
) => Promise<number>;
export type TuiImproveHandler = (bridge: TuiExecutionBridge) => Promise<number>;
export interface TuiRunOptions {
  readonly mode?: TuiMode;
}

const ALT_SCREEN_ENTER = "\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l";
const ALT_SCREEN_EXIT = "\u001b[?25h\u001b[?1049l";

export async function runTuiShell(
  context: CliContext,
  streams: {
    readonly input: NodeJS.ReadStream;
    readonly output: NodeJS.WriteStream;
    readonly writeControl?: (value: string) => void;
  },
  onInterrupt: () => void,
  onStart: TuiStartHandler,
  onImprove?: TuiImproveHandler,
  options?: TuiRunOptions,
): Promise<TuiAction> {
  const mode = options?.mode ?? "legacy";
  const runtime = mode === "fresh"
    ? { session: buildFreshUiViewFromContext(context), project: null }
    : await buildSessionRuntimeFromContext(context);
  const handlers: TuiSelectionHandlers = {
    getCurrentDesign: async () => {
      if (mode === "fresh" && context.figmaConnectionStatus() !== "connected") {
        await context.ensureFigmaConnection();
      }
      if (context.figmaConnectionStatus() !== "connected") return null;
      const selection = await context.getCurrentFigmaSelection();
      return selection === null ? null : designFromCurrentSelection(selection);
    },
    parseFigmaUrl: designFromUrl,
    ...(mode === "legacy" ? { getDestinations: () => findDestinationCandidates(context, runtime.project) } : {}),
  };
  return runTuiShellWithView(
    runtime.session,
    streams,
    onInterrupt,
    handlers,
    runtime.project?.id,
    onStart,
    {
      read: async (output) => {
        if (output.artifactSummary === undefined) throw new Error("Artifact summary unavailable.");
        return output.artifactSummary.version === undefined
          ? context.artifactInspection.getPayload(output.artifactSummary)
          : context.artifactInspection.getPayloadAtVersion(
              output.artifactSummary,
              output.artifactSummary.version,
            );
      },
    },
    onImprove,
    {
      status: context.aiStatus,
      signInWithGoogle: context.signInWithGoogle,
    },
    mode,
  );
}

export async function runTuiShellWithView(
  session: DesignFlowSessionView,
  streams: {
    readonly input: NodeJS.ReadStream;
    readonly output: NodeJS.WriteStream;
    readonly writeControl?: (value: string) => void;
  },
  onInterrupt: () => void,
  handlers: TuiSelectionHandlers,
  projectId?: string,
  onStart?: TuiStartHandler,
  artifactReader?: TuiArtifactReader,
  onImprove?: TuiImproveHandler,
  auth?: TuiAuthController,
  mode: TuiMode = "legacy",
): Promise<TuiAction> {
  (streams.writeControl ?? ((value: string) => safeWrite(streams.output, value)))(ALT_SCREEN_ENTER);

  let action: TuiAction = { type: "quit" };
  const instance = render(
    React.createElement(App, {
      session,
      ...(projectId === undefined ? {} : { projectId }),
      handlers,
      artifactReader: artifactReader ?? {
        read: async (output) => {
          if (output.artifactSummary === undefined) throw new Error("Artifact summary unavailable.");
          return { summary: output.artifactSummary, payload: undefined };
        },
      },
      onAction: (nextAction: TuiAction) => {
        action = nextAction;
      },
      onStart: onStart ?? (async () => 0),
      onInterrupt,
      ...(auth === undefined ? {} : { auth }),
      ...(onImprove === undefined ? {} : { onImprove }),
      mode,
    }),
    {
      stdin: streams.input,
      stdout: streams.output,
      exitOnCtrlC: false,
      patchConsole: true,
    },
  );

  try {
    await instance.waitUntilExit();
    return action;
  } finally {
    instance.cleanup();
    (streams.writeControl ?? ((value: string) => safeWrite(streams.output, value)))(ALT_SCREEN_EXIT);
  }
}

function safeWrite(output: NodeJS.WriteStream, value: string): void {
  try {
    output.write(value);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "EPIPE") throw error;
  }
}
