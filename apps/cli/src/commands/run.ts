import { Command } from "commander";
import { intro, outro, spinner } from "@clack/prompts";
import type { CliContext, RunResult } from "../types";
import { createCliContext } from "../context";
import { createWorkflowLoader } from "../workflows/loader";

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
        ctx = createCliContext(workflowId);

        const registry = await createWorkflowLoader();
        const manifest = registry.get(workflowId);
        if (!manifest) {
          spin.stop(`Unknown workflow: ${workflowId}`);
          const available = registry.list().map((m) => m.id).join(", ");
          ctx.logger.error(`Available workflows: ${available}`);
          process.exit(1);
        }

        manifest.load(ctx.registry);

        spin.stop("Execution context ready");

        ctx.logger.info(`Running: ${manifest.name} v${manifest.version}`);
        ctx.logger.info(`Run ID: ${ctx.executionContext.runId}`);

        spin.start("Executing workflow");
        const result = await ctx.engine.run(manifest.definition, ctx.executionContext);
        spin.stop("Execution complete");

        const runResult: RunResult = {
          workflowId,
          runId: ctx.executionContext.runId,
          status: result.success ? "completed" : "failed",
        };

        if (result.success) {
          ctx.logger.info(`Artifacts produced: ${result.artifacts.length}`);
          for (const artifact of result.artifacts) {
            ctx.logger.info(`  ${artifact.id} (${artifact.type})`);
          }
        } else {
          ctx.logger.error(`Execution failed: ${String(result.error)}`);
        }

        ctx.logger.info(JSON.stringify(runResult, null, 2));
        outro(`Run ${result.success ? "completed" : "failed"}`);
        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        spin.stop("Execution failed");
        ctx.logger.error(String(error));
        process.exit(1);
      }
    });
}
