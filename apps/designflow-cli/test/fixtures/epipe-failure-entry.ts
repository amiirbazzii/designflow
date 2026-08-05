#!/usr/bin/env bun
// apps/designflow-cli/test/fixtures/epipe-failure-entry.ts
//
// Failing-command half of the broken-pipe precedence acceptance test. Uses
// the REAL transport machinery — SignalCoordinator, BrokenPipeCoordinator,
// ExitOutcome/resolveExitCode, real stdout, real process exit status — with
// a stand-in command that produces a large report and then fails with a
// known nonzero code. The parent test closes the read side while buffered
// output is still flushing; the resulting late EPIPE must not overwrite the
// established exit code 3.

import { BrokenPipeCoordinator } from "../../src/services/broken-pipe";
import { ExitOutcome, resolveExitCode } from "../../src/services/exit-outcome";
import { SignalCoordinator } from "../../src/services/signal-coordinator";

const evidence = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const coordinator = new SignalCoordinator({ notify: evidence });
const outcome = new ExitOutcome();
const pipeGuard = new BrokenPipeCoordinator({
  onBrokenPipe: () => {
    evidence("PIPE-BROKEN");
    outcome.recordPipeBroken();
    coordinator.abortQuietly();
  },
});
pipeGuard.install();

function print(line: string): void {
  if (pipeGuard.isBroken("stdout")) return;
  try {
    process.stdout.write(`${line}\n`);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "EPIPE") throw error;
  }
}

const code = await coordinator.run(async () => {
  // A large report: far more than one pipe buffer, so the consumer can
  // close mid-flush deterministically.
  for (let i = 0; i < 20_000; i++) print(`REPORT LINE ${i}`);

  // The failure is established BEFORE it is reported — the EPIPE that
  // reporting into a closed pipe may raise is then provably late.
  outcome.recordResult(3);
  evidence("RESULT-RECORDED");
  print("error: fabricated command failure");
  return 3;
});

process.exitCode = resolveExitCode({
  interrupted: coordinator.interrupted,
  commandCode: code,
  stdoutBroken: pipeGuard.stdoutBroken,
  pipeBrokeBeforeResult: outcome.pipeBrokeBeforeResult,
});
evidence(`FINAL:${process.exitCode}`);
