// apps/designflow-demo/src/io.ts

/**
 * The demo's input/output port.
 *
 * The journey talks to this rather than to a terminal, so the same flow can be
 * driven by a person, by a test script, or later by an HTTP handler. It is the
 * seam that makes "tests focus on user behaviour" possible without a DOM or a
 * pseudo-terminal.
 */
export interface DemoIO {
  /** Writes one line of output. */
  print(line: string): void;
  /** Asks a question and resolves with the answer. */
  ask(question: string, options?: readonly string[]): Promise<string>;
  /** Replaces the last rendered frame, when the surface supports it. */
  redraw?(frame: string): void;
}

/** Drives the journey from a fixed list of answers, capturing what it printed. */
export class ScriptedIO implements DemoIO {
  public readonly output: string[] = [];
  public readonly questions: string[] = [];
  public readonly frames: string[] = [];

  private readonly answers: string[];

  public constructor(answers: readonly string[]) {
    this.answers = [...answers];
  }

  public print(line: string): void {
    this.output.push(line);
  }

  public redraw(frame: string): void {
    this.frames.push(frame);
  }

  public async ask(question: string): Promise<string> {
    this.questions.push(question);

    const answer = this.answers.shift();
    if (answer === undefined) {
      throw new Error(`ScriptedIO ran out of answers at: ${question}`);
    }

    return answer;
  }

  /** Everything printed, as one string. Convenient for assertions. */
  public get transcript(): string {
    return this.output.join("\n");
  }
}
