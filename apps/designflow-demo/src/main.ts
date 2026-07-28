#!/usr/bin/env bun
// apps/designflow-demo/src/main.ts
import { createInterface } from "node:readline/promises";
import { runDemo } from "./app";
import { createDemoHost } from "./host";
import type { DemoIO } from "./io";

/**
 * Terminal entry point.
 *
 * The only place the demo touches stdin/stdout. Everything above it works
 * through `DemoIO`, which is why the journey is testable without a terminal.
 */

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function prompt(question: string, options?: readonly string[]): string {
  return options !== undefined
    ? `${question} [${options.join(" / ")}]: `
    : `${question}: `;
}

/**
 * Interactive IO, for a real terminal.
 */
function createInteractiveIO(): { io: DemoIO; close: () => void } {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    io: {
      print,
      redraw: (frame) => print(`${frame}\n`),
      ask: (question, options) => readline.question(prompt(question, options)),
    },
    close: () => readline.close(),
  };
}

/**
 * Piped IO, for `printf ... | wf-demo`.
 *
 * `readline/promises` stalls after its first read when stdin is not a TTY, so
 * piped input is drained up front and served from a queue instead. Without
 * this the demo cannot be scripted, which is how most people will first see
 * it.
 */
async function createPipedIO(): Promise<{ io: DemoIO; close: () => void }> {
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += String(chunk);
  }

  const answers = buffer.split("\n");

  return {
    io: {
      print,
      redraw: (frame) => print(`${frame}\n`),
      async ask(question, options) {
        const answer = answers.shift() ?? "";
        print(`${prompt(question, options)}${answer}`);
        return answer;
      },
    },
    close: () => {},
  };
}

async function main(): Promise<void> {
  const { io, close } = process.stdin.isTTY === true
    ? createInteractiveIO()
    : await createPipedIO();

  try {
    const result = await runDemo(createDemoHost(), io);
    print("");
    print(`Execution ${result.executionId} finished as ${result.state}.`);
  } finally {
    close();
  }
}

await main();
