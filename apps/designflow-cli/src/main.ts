#!/usr/bin/env node
// apps/designflow-cli/src/main.ts
import { createInterface } from "node:readline";
import { dispatch } from "./cli";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import { BrokenPipeCoordinator } from "./services/broken-pipe";
import { ExitOutcome, resolveExitCode } from "./services/exit-outcome";
import { SignalCoordinator } from "./services/signal-coordinator";
import { formatError } from "./ui/errors";
import type { Terminal } from "./ui/terminal";

class TerminalInterruptedError extends Error {
  public constructor() {
    super("Terminal input interrupted");
    this.name = "TerminalInterruptedError";
  }
}

/**
 * Process entry point.
 *
 * The only place the CLI touches stdin, stdout or `process.exit`. Everything
 * above works through `Terminal`, which is why the commands are testable
 * without a pseudo-terminal.
 */

// Set once per invocation in main(); print() consults it so that after a
// consumer closes the pipe, every later write anywhere in the CLI becomes a
// safe no-op instead of a second EPIPE.
let activePipeGuard: BrokenPipeCoordinator | undefined;

function print(line = ""): void {
  if (activePipeGuard?.isBroken("stdout") === true) return;
  try {
    process.stdout.write(`${line}\n`);
  } catch (error) {
    // A destroyed pipe can also throw synchronously; that exact condition
    // is the one thing safe to ignore here.
    if ((error as { code?: unknown }).code !== "EPIPE") throw error;
  }
}

function prompt(question: string, options?: readonly string[]): string {
  return options !== undefined
    ? `${question} [${options.join(" / ")}]: `
    : `${question}: `;
}

function interactiveTerminal(onInterrupt: () => void): {
  terminal: Terminal;
  close: () => void;
} {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let rejectPending: (() => void) | undefined;

  // A terminal-mode readline swallows Ctrl+C instead of letting it reach the
  // process-level handlers, so its SIGINT event is forwarded to the same
  // coordinator the process handlers use. Rejecting the pending question is
  // important for the product shell: the first Ctrl+C must unwind the prompt
  // and let the existing root cancellation path finish cleanly.
  readline.on("SIGINT", () => {
    onInterrupt();
    rejectPending?.();
    rejectPending = undefined;
    readline.close();
  });

  return {
    terminal: {
      print,
      ask: (question, options) =>
        new Promise<string>((resolve, reject) => {
          let settled = false;
          rejectPending = () => {
            if (settled) return;
            settled = true;
            reject(new TerminalInterruptedError());
          };

          readline.question(prompt(question, options), (answer) => {
            if (settled) return;
            settled = true;
            rejectPending = undefined;
            resolve(answer);
          });
        }),
    },
    close: () => readline.close(),
  };
}

/**
 * Piped input, for `printf ... | designflow`.
 *
 * `readline/promises` stalls after its first read when stdin is not a TTY, so
 * scripted input is drained up front and served from a queue. A CLI that
 * cannot be scripted cannot be used in CI or shown in a README.
 */
async function pipedTerminal(emptyInputAnswer = ""): Promise<{
  terminal: Terminal;
  close: () => void;
}> {
  let buffer = "";
  for await (const chunk of process.stdin) buffer += String(chunk);

  const answers = buffer.length === 0 ? [] : buffer.split("\n");

  return {
    terminal: {
      print,
      async ask(question, options) {
        const answer = answers.shift() ?? emptyInputAnswer;
        print(`${prompt(question, options)}${answer}`);
        return answer;
      },
    },
    close: () => {},
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  const coordinator = new SignalCoordinator({ notify: print });

  // A consumer closing the pipe is a normal pipeline event: stop writing,
  // cancel any active work through the same root signal Ctrl+C uses (as a
  // quiet host cancellation, not an interrupt), and exit 0 — the consumer
  // already got what it needed, and `set -o pipefail` scripts must not see
  // a failure.
  const outcome = new ExitOutcome();
  const pipeGuard = new BrokenPipeCoordinator({
    onBrokenPipe: () => {
      outcome.recordPipeBroken();
      coordinator.abortQuietly();
    },
  });
  activePipeGuard = pipeGuard;
  pipeGuard.install();

  // Reading stdin for a non-interactive command would block on a pipe that
  // never closes, so only the prompting paths drain it.
  const needsInput = argv.length === 0 || argv[0] === "run" || argv[0] === "answer" || argv[0] === "feedback-loop";

  const { terminal, close } =
    needsInput && process.stdin.isTTY !== true
      ? await pipedTerminal(argv.length === 0 ? "q" : "")
      : interactiveTerminal(() => coordinator.interrupt());

  // Built inside the guard: preparing `~/.designflow` is filesystem work, so
  // this is exactly where a permissions or disk problem surfaces, and it
  // deserves the same explanation as any other failure rather than a raw trace.
  let context: CliContext | undefined;

  try {
    const code = await coordinator.run(async (signal) => {
      try {
        context = createCliContext({
          signal,
          autoConnectFigmaDesktop: argv.length === 0,
        });
        const commandCode = await dispatch(argv, context, terminal);
        outcome.recordResult(commandCode);
        return commandCode;
      } catch (error) {
        if (error instanceof TerminalInterruptedError) {
          outcome.recordResult(130);
          return 130;
        }

        // Recorded BEFORE the error is printed: the EPIPE that reporting a
        // failure into a closed pipe may trigger is then provably late and
        // cannot convert this established failure into a success.
        outcome.recordResult(1);
        print(formatError(error));
        return 1;
      } finally {
        context?.close();
        close();
      }
    });
    return resolveExitCode({
      interrupted: coordinator.interrupted,
      commandCode: code,
      stdoutBroken: pipeGuard.stdoutBroken,
      pipeBrokeBeforeResult: outcome.pipeBrokeBeforeResult,
    });
  } catch (error) {
    pipeGuard.uninstall();
    activePipeGuard = undefined;
    throw error;
  }
  // Deliberately NOT uninstalled on the success path: stdout writes are
  // buffered, so the EPIPE for the final lines can arrive *after* main()
  // returns, while the loop drains — exactly when the listener is still
  // needed. The process is exiting; there is nothing to leak.
}

// `process.exitCode` instead of `process.exit()`: the loop drains buffered
// stdout before exiting, so a piped `designflow ... | head` never loses the
// tail of its output. Forced exit (second Ctrl+C) is the coordinator's job.
process.exitCode = await main();
