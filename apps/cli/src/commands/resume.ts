import { Command } from "commander";
import { intro, outro, spinner } from "@clack/prompts";
import type { CliContext, ResumeResult } from "../types";
import { createCliContext } from "../context";
import { createWorkflowLoader } from "../workflows/loader";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .description("Resume a workflow run from a checkpoint")
    .argument("<workflow-id>", "Workflow ID to resume")
    .action(async (workflowId: string): Promise<void> => {
      intro(`wf resume ${workflowId}`);

      const spin = spinner();
      spin.start("Loading workflow");

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

        spin.stop("Checkpoint loaded");

        ctx.logger.info(`Workflow: ${manifest.name}`);

        spin.start("Resuming workflow execution");
        const result = await ctx.engine.resume(manifest.definition, workflowId);
        spin.stop("Resume complete");

        const resumeResult: ResumeResult = {
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

        ctx.logger.info(JSON.stringify(resumeResult, null, 2));
        outro(`Resume ${result.success ? "completed" : "failed"}`);
        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        spin.stop("Resume failed");
        ctx.logger.error(String(error));
        process.exit(1);
      }
    });
}
