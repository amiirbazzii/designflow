import React from "react";
import { render } from "ink";
import { App, type TuiAction } from "./app";
import { buildSessionViewFromContext, type DesignFlowSessionView } from "./model";
import type { CliContext } from "../../services/cli-runner";

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
): Promise<TuiAction> {
  const session = await buildSessionViewFromContext(context);
  return runTuiShellWithView(session, streams, onInterrupt);
}

export async function runTuiShellWithView(
  session: DesignFlowSessionView,
  streams: {
    readonly input: NodeJS.ReadStream;
    readonly output: NodeJS.WriteStream;
    readonly writeControl?: (value: string) => void;
  },
  onInterrupt: () => void,
): Promise<TuiAction> {
  (streams.writeControl ?? ((value: string) => safeWrite(streams.output, value)))(ALT_SCREEN_ENTER);

  let action: TuiAction = "quit";
  const instance = render(
    React.createElement(App, {
      session,
      onAction: (nextAction: TuiAction) => {
        action = nextAction;
      },
      onInterrupt,
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
