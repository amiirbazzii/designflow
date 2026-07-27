// apps/cli/src/commands/run.ts
import { Command } from "commander";
import { intro, outro, spinner } from "@clack/prompts";
import type { CliContext, RunResult } from "../types";
import { createCliContext } from "../context";
import { createWorkflowLoader } from "../workflows/loader";
import { createCapabilityRegistry } from "../capabilities";
import { InMemoryEventPublisher } from "@designflow/core";
import { CliLogger } from "../logger";

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Execute a workflow")
    .argument("<workflow-id>", "ID of the workflow to run")
    .action(async (workflowId: string): Promise<void> => {
      intro(`wf run ${workflowId}`);

      const spin = spinner();
      spin.start("Initializing execution context");

      let ctx!: CliContext;

      try {
        const workflowLoader = await createWorkflowLoader();
        const manifest = workflowLoader.get(workflowId);

        if (!manifest) {
          spin.stop(`Unknown workflow: ${workflowId}`);
          const available = workflowLoader.list().map((m) => m.id).join(", ");
          process.stderr.write(`Available workflows: ${available}\n`);
          process.exit(1);
        }

        const capabilityRegistry = await createCapabilityRegistry();
        const logger = new CliLogger();
        const eventPublisher = new InMemoryEventPublisher(logger);

        ctx = createCliContext({
          workflowResolver: (id) => workflowLoader.get(id),
          capabilityRegistry,
          eventPublisher,
        });

        spin.stop("Execution context ready");

        ctx.logger.info(`Running workflow: ${workflowId}`);

        spin.start("Executing workflow");
        const result = await ctx.executionService.execute({ workflowId });
        spin.stop("Execution complete");

        const runResult: RunResult = {
          workflowId,
          runId: result.executionId,
          status: result.status,
        };

        if (result.status === "completed") {
          ctx.logger.info(`Artifacts produced: ${result.artifacts.length}`);
          for (const artifact of result.artifacts) {
            ctx.logger.info(`  ${artifact.id} (${artifact.type})`);
          }
        } else {
          ctx.logger.error(`Execution failed: ${result.error?.message ?? "Unknown error"}`);
        }

        ctx.logger.info(JSON.stringify(runResult, null, 2));
        outro(`Run ${result.status === "completed" ? "completed" : "failed"}`);
        if (result.status !== "completed") {
          process.exit(1);
        }
      } catch (error) {
        spin.stop("Execution failed");
        ctx.logger.error(String(error));
        process.exit(1);
      }
    });
}
