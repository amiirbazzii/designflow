// apps/designflow-cli/src/ui/terminal.ts

/**
 * Terminal rendering and the IO port.
 *
 * Kept apart from every command so the product logic is testable without a
 * terminal: commands talk to `Terminal`, and `ScriptedTerminal` drives them
 * from a list of answers while capturing what was printed.
 *
 * Nothing here knows what a workflow is. It formats strings.
 */

export interface Terminal {
  print(line?: string): void;
  ask(question: string, options?: readonly string[]): Promise<string>;
}

const RULE = "─".repeat(46);

export function heading(title: string): string {
  return `${title}\n${RULE}`;
}

export function banner(): string {
  return [
    "Welcome to DesignFlow",
    "",
    "AI workflows that turn ideas into results.",
  ].join("\n");
}

export function menu(): string {
  return [
    "",
    "Available actions:",
    "",
    "  1. Run workflow",
    "  2. View history",
    "  3. Exit",
    "",
  ].join("\n");
}

/** `✓` done, `→` underway, `○` not started. */
export function stepMarker(status: string): string {
  return status === "done" ? "✓" : status === "active" ? "→" : "○";
}

export function usage(): string {
  return [
    "designflow — AI workflows that turn ideas into results",
    "",
    "Usage:",
    "  designflow                 Interactive mode",
    "  designflow list            Show available workflows",
    "  designflow run <workflow>  Run a workflow",
    "  designflow history         Show previous runs",
    "",
    "Options:",
    "  -h, --help                 Show this help",
    "  -v, --version              Show the installed version",
    "",
  ].join("\n");
}

/** "Today 09:14" for a recent run, a date for anything older. */
export function formatWhen(timestamp: number): string {
  const when = new Date(timestamp);
  const now = new Date();

  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();

  const time = when.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return sameDay ? `Today ${time}` : when.toLocaleDateString();
}

/** Drives a command from a fixed list of answers, capturing its output. */
export class ScriptedTerminal implements Terminal {
  public readonly output: string[] = [];
  public readonly questions: string[] = [];

  private readonly answers: string[];

  public constructor(answers: readonly string[] = []) {
    this.answers = [...answers];
  }

  public print(line = ""): void {
    this.output.push(line);
  }

  public async ask(question: string): Promise<string> {
    this.questions.push(question);

    const answer = this.answers.shift();
    if (answer === undefined) {
      throw new Error(`ScriptedTerminal ran out of answers at: ${question}`);
    }

    return answer;
  }

  public get transcript(): string {
    return this.output.join("\n");
  }
}
