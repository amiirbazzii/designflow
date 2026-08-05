// apps/designflow-cli/src/services/signal-coordinator.ts
//
// The one place OS interruption becomes domain cancellation. Owns the root
// `AbortController` a CLI invocation hands to the composition root, and the
// SIGINT/SIGTERM lifecycle around it. Agents, capabilities, and services
// below never install process handlers — they only observe the signal.

/** The slice of `process` the coordinator needs — injectable for tests. */
export interface SignalSource {
  on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface SignalCoordinatorOptions {
  /** Defaults to the real `process`. Tests inject an EventEmitter. */
  readonly source?: SignalSource;
  /** Writes the one-line interrupt notices. Defaults to stderr. */
  readonly notify?: (line: string) => void;
  /**
   * Invoked on the second interrupt, after graceful cancellation was already
   * requested. Defaults to `process.exit(130)` — the only immediate exit the
   * CLI ever performs, and only because the user asked twice.
   */
  readonly forceExit?: (code: number) => void;
}

/** Conventional exit status for an interrupted process (128 + SIGINT). */
export const INTERRUPT_EXIT_CODE = 130;

/**
 * First interrupt: abort the root controller exactly once and let the
 * operation unwind through its own signal-aware paths. Second interrupt:
 * force immediate termination with code 130. Handlers exist only while
 * `run()` is active and are removed in `finally`, so repeated operations
 * never accumulate listeners.
 */
export class SignalCoordinator {
  private readonly controller = new AbortController();
  private readonly source: SignalSource;
  private readonly notify: (line: string) => void;
  private readonly forceExit: (code: number) => void;
  private interrupts = 0;

  public constructor(options: SignalCoordinatorOptions = {}) {
    this.source = options.source ?? process;
    this.notify = options.notify ?? ((line) => process.stderr.write(`${line}\n`));
    this.forceExit = options.forceExit ?? ((code) => process.exit(code));
  }

  /** The root signal every runtime layer below receives. */
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * True once a real user interrupt happened. Deliberately NOT derived from
   * `signal.aborted`: a quiet host-side abort (broken output pipe) cancels
   * work but is not an interrupt and must not produce exit code 130.
   */
  public get interrupted(): boolean {
    return this.interrupts > 0;
  }

  /**
   * Routes one interruption. Public so a terminal-mode readline — which
   * swallows Ctrl+C instead of letting it reach process handlers — can
   * forward its own SIGINT event here.
   */
  public interrupt(): void {
    this.interrupts += 1;
    if (this.interrupts === 1) {
      // Abort exactly once; a completed operation with an aborted signal is
      // harmless, an operation still running unwinds gracefully.
      if (!this.controller.signal.aborted) {
        this.notify("Interrupted — finishing safely (press Ctrl+C again to force quit)...");
        this.controller.abort();
      }
      return;
    }
    if (this.interrupts === 2) {
      this.notify("Force quitting.");
      this.forceExit(INTERRUPT_EXIT_CODE);
    }
    // Third and later interrupts: forceExit already ran (or was injected to
    // no-op in tests); nothing further to do.
  }

  /**
   * Cancels the root signal without counting as a user interrupt: no
   * notice, no effect on the exit code, no forced-exit escalation. Used by
   * the broken-pipe coordinator — a closed consumer wants remaining work
   * stopped, but it is not a Ctrl+C.
   */
  public abortQuietly(): void {
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  /**
   * Runs one operation under signal management. Returns the operation's exit
   * code, or 130 when the operation ended after an interrupt.
   */
  public async run(operation: (signal: AbortSignal) => Promise<number>): Promise<number> {
    const onSignal = (): void => this.interrupt();
    this.source.on("SIGINT", onSignal);
    this.source.on("SIGTERM", onSignal);
    try {
      const code = await operation(this.controller.signal);
      return this.interrupted ? INTERRUPT_EXIT_CODE : code;
    } finally {
      this.source.off("SIGINT", onSignal);
      this.source.off("SIGTERM", onSignal);
    }
  }
}
