import { Command } from "commander";
import { intro, outro, spinner } from "@clack/prompts";
import type { CliContext, ResumeResult } from "../types";
import { createCliContext } from "../context";
import { createWorkflowLoader } from "../workflows/loader";
import { createCapabilityRegistry } from "../capabilities";

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
        const workflowLoader = await createWorkflowLoader();
        const manifest = workflowLoader.get(workflowId);

        if (!manifest) {
          spin.stop(`Unknown workflow: ${workflowId}`);
          const available = workflowLoader.list().map((m) => m.id).join(", ");
          process.stderr.write(`Available workflows: ${available}\n`);
          process.exit(1);
        }

        const capabilityRegistry = await createCapabilityRegistry();

        ctx = createCliContext(
          (id) => workflowLoader.get(id),
          capabilityRegistry,
        );

        spin.stop("Checkpoint loaded");

        ctx.logger.info(`Resuming workflow: ${workflowId}`);

        spin.start("Resuming workflow execution");
        const result = await ctx.executionService.resume(workflowId);
        spin.stop("Resume complete");

        const resumeResult: ResumeResult = {
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

        ctx.logger.info(JSON.stringify(resumeResult, null, 2));
        outro(`Resume ${result.status === "completed" ? "completed" : "failed"}`);
        if (result.status !== "completed") {
          process.exit(1);
        }
      } catch (error) {
        spin.stop("Resume failed");
        ctx.logger.error(String(error));
        process.exit(1);
      }
    });
}
