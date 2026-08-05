#!/usr/bin/env bun
// apps/designflow-cli/test/fixtures/sigint-subprocess-entry.ts
//
// Subprocess half of the SIGINT acceptance test. Runs the REAL production
// pieces — `SignalCoordinator`, `createCliContext` (the full composition
// root), and `WorkflowRunner.start` against the experimental Figma workflow
// backed by the fake MCP server — in a real child process that receives a
// real SIGINT from the test. Only the argv dispatch layer is bypassed, so
// the launch input can be provided deterministically without driving
// interactive prompts.
//
// Configuration arrives through the environment the test controls:
// DESIGNFLOW_HOME points at a prepared workspace whose config.json enables
// the experimental workflow and the fake server (with a long tool delay so
// the run is reliably in flight when the signal lands).

import { createCliContext } from "../../src/services/cli-runner";
import { SignalCoordinator } from "../../src/services/signal-coordinator";

const coordinator = new SignalCoordinator({
  notify: (line) => process.stdout.write(`${line}\n`),
});

process.exitCode = await coordinator.run(async (signal) => {
  const context = createCliContext({ signal });
  try {
    let announced = false;
    context.onProgress(() => {
      if (!announced) {
        announced = true;
        process.stdout.write("STARTED\n");
      }
    });
    process.stdout.write("READY\n");

    const handle = await context.runner.start({
      workflowId: "design-to-code-figma-specification",
      input: {
        designFile: "https://www.figma.com/design/abc123XYZ/Homepage",
        frames: ["Header"],
        captureScreenshots: false,
        figmaAgentVersion: "0.2.0",
      },
    });

    process.stdout.write(`STATE:${handle.state}\n`);
    process.stdout.write(`EXECUTION:${handle.executionId}\n`);
    return handle.state === "ready" ? 0 : 1;
  } finally {
    context.close();
    process.stdout.write("CLOSED\n");
  }
});
