import { Command } from "commander";
import { intro, outro, spinner, log } from "@clack/prompts";
import type { RunResult } from "../types";
import { createCliContext } from "../context";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Execute a workflow")
    .argument("<workflow-name>", "Name of the workflow to run")
    .action(async (workflowName: string): Promise<void> => {
      intro(`wf run ${workflowName}`);

      const spin = spinner();
      spin.start("Initializing execution context");

      try {
        const ctx = createCliContext(workflowName);

        spin.stop("Initialization complete");

        log.info(`Workflow: ${workflowName}`);
        log.info(`Run ID: ${ctx.executionContext.runId}`);

        const result: RunResult = {
          workflowId: workflowName,
          runId: ctx.executionContext.runId,
          status: "initialized",
        };

        ctx.logger.info(JSON.stringify(result, null, 2));
        outro("Run initialized successfully");
      } catch (error) {
        spin.stop("Initialization failed");
        log.error(String(error));
        process.exit(1);
      }
    });
}
