#!/usr/bin/env node
// apps/designflow-cli/src/main.ts
import { createInterface } from "node:readline/promises";
import { dispatch } from "./cli";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import { formatError } from "./ui/errors";
import type { Terminal } from "./ui/terminal";

/**
 * Process entry point.
 *
 * The only place the CLI touches stdin, stdout or `process.exit`. Everything
 * above works through `Terminal`, which is why the commands are testable
 * without a pseudo-terminal.
 */

function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function prompt(question: string, options?: readonly string[]): string {
  return options !== undefined
    ? `${question} [${options.join(" / ")}]: `
    : `${question}: `;
}

function interactiveTerminal(): { terminal: Terminal; close: () => void } {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    terminal: {
      print,
      ask: (question, options) => readline.question(prompt(question, options)),
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
async function pipedTerminal(): Promise<{
  terminal: Terminal;
  close: () => void;
}> {
  let buffer = "";
  for await (const chunk of process.stdin) buffer += String(chunk);

  const answers = buffer.split("\n");

  return {
    terminal: {
      print,
      async ask(question, options) {
        const answer = answers.shift() ?? "";
        print(`${prompt(question, options)}${answer}`);
        return answer;
      },
    },
    close: () => {},
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // Reading stdin for a non-interactive command would block on a pipe that
  // never closes, so only the prompting paths drain it.
  const needsInput = argv.length === 0 || argv[0] === "run" || argv[0] === "answer";

  const { terminal, close } =
    needsInput && process.stdin.isTTY !== true
      ? await pipedTerminal()
      : interactiveTerminal();

  // Built inside the guard: preparing `~/.designflow` is filesystem work, so
  // this is exactly where a permissions or disk problem surfaces, and it
  // deserves the same explanation as any other failure rather than a raw trace.
  let context: CliContext | undefined;

  try {
    context = createCliContext();
    return await dispatch(argv, context, terminal);
  } catch (error) {
    print(formatError(error));
    return 1;
  } finally {
    context?.close();
    close();
  }
}

process.exit(await main());
