#!/usr/bin/env bun
// apps/designflow-cli/test/fixtures/epipe-subprocess-entry.ts
//
// Subprocess half of the broken-pipe acceptance test. Identical shape to
// the SIGINT fixture — real SignalCoordinator, real BrokenPipeCoordinator,
// real composition root, real fake-MCP-backed workflow — but instead of a
// signal, the parent test destroys its end of stdout mid-run. A heartbeat
// keeps writing so the closed pipe is discovered promptly (exactly what a
// progress-printing CLI does); the resulting EPIPE must cancel the run
// through the root signal and exit 0.
//
// Because stdout dies mid-test, all evidence markers go to stderr.

import { createCliContext } from "../../src/services/cli-runner";
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

const code = await coordinator.run(async (signal) => {
  const context = createCliContext({ signal });
  const heartbeat = setInterval(() => {
    if (!pipeGuard.isBroken("stdout")) process.stdout.write("TICK\n");
  }, 25);
  try {
    let announced = false;
    context.onProgress(() => {
      if (!announced) {
        announced = true;
        evidence("STARTED");
      }
    });
    evidence("READY");

    const handle = await context.runner.start({
      workflowId: "design-to-code-figma-specification",
      input: {
        designFile: "https://www.figma.com/design/abc123XYZ/Homepage",
        frames: ["Header"],
        captureScreenshots: false,
        figmaAgentVersion: "0.2.0",
      },
    });

    evidence(`STATE:${handle.state}`);
    const commandCode = handle.state === "ready" ? 0 : 1;
    outcome.recordResult(commandCode);
    return commandCode;
  } finally {
    clearInterval(heartbeat);
    context.close();
    evidence("CLOSED");
  }
});

process.exitCode = resolveExitCode({
  interrupted: coordinator.interrupted,
  commandCode: code,
  stdoutBroken: pipeGuard.stdoutBroken,
  pipeBrokeBeforeResult: outcome.pipeBrokeBeforeResult,
});
