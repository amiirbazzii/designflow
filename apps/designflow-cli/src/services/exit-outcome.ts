// apps/designflow-cli/src/services/exit-outcome.ts
//
// Deterministic exit-code selection for one CLI invocation. A broken output
// pipe is a transport condition — it may suppress output, and it may excuse
// the failure it *caused* (a run cancelled because the consumer left), but
// it must never erase a command result that was already established before
// the pipe broke. The distinct facts are tracked separately, never collapsed
// into one boolean, and the command result is recorded before any failure
// reporting writes so a late EPIPE cannot reorder them.

import { INTERRUPT_EXIT_CODE } from "./signal-coordinator";

/** Order-aware record of what one invocation actually did. */
export class ExitOutcome {
  private commandCode: number | undefined;
  private brokeBeforeResult = false;

  /** Call from the broken-pipe handler. Order-sensitive by design. */
  public recordPipeBroken(): void {
    if (this.commandCode === undefined) this.brokeBeforeResult = true;
  }

  /**
   * Records the command's own result exactly once — callers must invoke
   * this BEFORE printing any failure report, so the EPIPE those writes may
   * trigger is provably "late".
   */
  public recordResult(code: number): void {
    if (this.commandCode === undefined) this.commandCode = code;
  }

  /** True when stdout closed before the command had an established result. */
  public get pipeBrokeBeforeResult(): boolean {
    return this.brokeBeforeResult;
  }
}

export interface ExitCodeFacts {
  /** A real user SIGINT/SIGTERM happened (never a quiet host cancellation). */
  readonly interrupted: boolean;
  /** The command's own recorded result (130 when the runner reported interrupt). */
  readonly commandCode: number;
  /** stdout received EPIPE at some point. */
  readonly stdoutBroken: boolean;
  /** stdout broke before the command result existed — the pipe afflicted the run. */
  readonly pipeBrokeBeforeResult: boolean;
}

/**
 * Precedence: (1) real interrupt → 130; (2) an established command result —
 * success or failure — stands, even if a stream broke afterwards while the
 * failure was being reported; (3) only a stdout pipe that broke BEFORE the
 * result existed converts the outcome to the quiet pipeline exit 0 (the
 * consumer left mid-run; whatever nonzero state remains was caused by that
 * departure); (4) otherwise the command's own code.
 */
export function resolveExitCode(facts: ExitCodeFacts): number {
  if (facts.interrupted) return INTERRUPT_EXIT_CODE;
  if (facts.stdoutBroken && facts.pipeBrokeBeforeResult) return 0;
  return facts.commandCode;
}
