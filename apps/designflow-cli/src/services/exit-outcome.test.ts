// apps/designflow-cli/src/services/exit-outcome.test.ts
import { describe, expect, test } from "bun:test";
import { ExitOutcome, resolveExitCode } from "./exit-outcome";
import { INTERRUPT_EXIT_CODE } from "./signal-coordinator";

function facts(outcome: ExitOutcome, commandCode: number, extra?: { interrupted?: boolean; stdoutBroken?: boolean }): number {
  return resolveExitCode({
    interrupted: extra?.interrupted ?? false,
    commandCode,
    stdoutBroken: extra?.stdoutBroken ?? false,
    pipeBrokeBeforeResult: outcome.pipeBrokeBeforeResult,
  });
}

describe("exit-code precedence", () => {
  test("normal success with no EPIPE exits 0", () => {
    const outcome = new ExitOutcome();
    outcome.recordResult(0);
    expect(facts(outcome, 0)).toBe(0);
  });

  test("normal success followed by late EPIPE exits 0", () => {
    const outcome = new ExitOutcome();
    outcome.recordResult(0);
    outcome.recordPipeBroken();
    expect(facts(outcome, 0, { stdoutBroken: true })).toBe(0);
  });

  test("command failure with no EPIPE keeps its original code", () => {
    const outcome = new ExitOutcome();
    outcome.recordResult(2);
    expect(facts(outcome, 2)).toBe(2);
  });

  test("command failure followed by late stdout EPIPE keeps its original code", () => {
    const outcome = new ExitOutcome();
    outcome.recordResult(2);
    outcome.recordPipeBroken();
    expect(facts(outcome, 2, { stdoutBroken: true })).toBe(2);
  });

  test("command failure followed by late stderr-only EPIPE keeps its original code", () => {
    const outcome = new ExitOutcome();
    outcome.recordResult(2);
    outcome.recordPipeBroken();
    // stderr broke, stdout did not: never grants the quiet 0.
    expect(facts(outcome, 2, { stdoutBroken: false })).toBe(2);
  });

  test("a real interrupt wins over EPIPE with 130", () => {
    const outcome = new ExitOutcome();
    outcome.recordPipeBroken();
    outcome.recordResult(1);
    expect(facts(outcome, INTERRUPT_EXIT_CODE, { interrupted: true, stdoutBroken: true })).toBe(INTERRUPT_EXIT_CODE);
  });

  test("quiet EPIPE cancellation without an independent failure exits 0", () => {
    const outcome = new ExitOutcome();
    // The pipe broke BEFORE the run produced its (cancellation-induced) result.
    outcome.recordPipeBroken();
    outcome.recordResult(1);
    expect(facts(outcome, 1, { stdoutBroken: true })).toBe(0);
  });

  test("repeated EPIPE does not alter the selected result", () => {
    const outcome = new ExitOutcome();
    outcome.recordResult(2);
    outcome.recordPipeBroken();
    outcome.recordPipeBroken();
    outcome.recordPipeBroken();
    expect(facts(outcome, 2, { stdoutBroken: true })).toBe(2);
    expect(outcome.pipeBrokeBeforeResult).toBe(false);
  });

  test("the first recorded result is immutable", () => {
    const outcome = new ExitOutcome();
    outcome.recordResult(2);
    outcome.recordResult(0);
    outcome.recordPipeBroken();
    expect(facts(outcome, 2, { stdoutBroken: true })).toBe(2);
  });
});
