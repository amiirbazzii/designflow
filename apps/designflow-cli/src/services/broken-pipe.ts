// apps/designflow-cli/src/services/broken-pipe.ts
//
// The one place a closed output pipe is recognized. When a downstream
// consumer (`designflow workers | grep -q …`) exits early, further writes
// to stdout/stderr emit an `EPIPE` stream error — a normal pipeline
// condition, not an application failure. This coordinator turns that into
// host-level state: writes to the broken stream become no-ops, an active
// operation is cancelled through the existing root signal, and nothing is
// ever written to a stream known to be closed. Unrelated stream errors are
// not swallowed — they keep their normal crash-visible behavior.

/** The slice of a writable stream the coordinator needs — injectable for tests. */
export interface PipeErrorSource {
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
}

export interface BrokenPipeCoordinatorOptions {
  /** Defaults to the real `process.stdout` / `process.stderr`. */
  readonly stdout?: PipeErrorSource;
  readonly stderr?: PipeErrorSource;
  /**
   * Invoked exactly once, on the first broken pipe across either stream.
   * The CLI host uses this to cancel active work through the existing root
   * cancellation signal — never a second cancellation architecture.
   */
  readonly onBrokenPipe?: () => void;
  /**
   * Receives stream errors that are NOT broken pipes. Defaults to
   * rethrowing, which preserves the normal unhandled-crash visibility of a
   * genuine stream failure. Injectable so unit tests can observe it.
   */
  readonly onUnrelatedError?: (stream: "stdout" | "stderr", error: Error) => void;
}

function isBrokenPipe(error: Error): boolean {
  return (error as { code?: unknown }).code === "EPIPE";
}

export class BrokenPipeCoordinator {
  private readonly stdout: PipeErrorSource;
  private readonly stderr: PipeErrorSource;
  private readonly onBrokenPipe: (() => void) | undefined;
  private readonly onUnrelatedError: (stream: "stdout" | "stderr", error: Error) => void;

  private readonly broken = new Set<"stdout" | "stderr">();
  private notified = false;
  private installed = false;

  private readonly onStdoutError = (error: Error): void => this.handle("stdout", error);
  private readonly onStderrError = (error: Error): void => this.handle("stderr", error);

  public constructor(options: BrokenPipeCoordinatorOptions = {}) {
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.onBrokenPipe = options.onBrokenPipe;
    this.onUnrelatedError =
      options.onUnrelatedError ??
      ((_stream, error) => {
        // Rethrow so a genuine stream failure surfaces exactly as it would
        // without this coordinator installed.
        throw error;
      });
  }

  /** True once the named stream received EPIPE — writes to it must stop. */
  public isBroken(stream: "stdout" | "stderr"): boolean {
    return this.broken.has(stream);
  }

  public get stdoutBroken(): boolean {
    return this.broken.has("stdout");
  }

  /** Idempotent; never installs duplicate listeners. */
  public install(): void {
    if (this.installed) return;
    this.installed = true;
    this.stdout.on("error", this.onStdoutError);
    this.stderr.on("error", this.onStderrError);
  }

  /** Removed in the caller's `finally`, so invocations never accumulate listeners. */
  public uninstall(): void {
    if (!this.installed) return;
    this.installed = false;
    this.stdout.off("error", this.onStdoutError);
    this.stderr.off("error", this.onStderrError);
  }

  private handle(stream: "stdout" | "stderr", error: Error): void {
    if (!isBrokenPipe(error)) {
      this.onUnrelatedError(stream, error);
      return;
    }

    this.broken.add(stream);

    // Exactly one cancellation, no matter how many streams break or how
    // many EPIPE events one stream emits.
    if (!this.notified) {
      this.notified = true;
      this.onBrokenPipe?.();
    }
  }
}
