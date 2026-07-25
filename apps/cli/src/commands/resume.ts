import { Command } from "commander";
import { intro, outro } from "@clack/prompts";
import { LocalStateStore } from "@designflow/state";
import type { ResumeResult } from "../types";
import { CliLogger } from "../logger";

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .description("Resume a workflow run from a checkpoint")
    .argument("<workflow-id>", "Workflow ID to resume")
    .action(async (workflowId: string): Promise<void> => {
      intro(`wf resume ${workflowId}`);

      const logger = new CliLogger();
      const stateStore = new LocalStateStore();

      try {
        const history = await stateStore.listHistory(workflowId);

        if (history.length === 0) {
          logger.error(`No checkpoints found for workflow "${workflowId}".`);
          process.exit(1);
        }

        const latestRecord = history[history.length - 1];
        if (!latestRecord) {
          logger.error(`No checkpoints found for workflow "${workflowId}".`);
          process.exit(1);
        }

        const checkpoint = await stateStore.loadCheckpoint(
          workflowId,
          latestRecord.checkpointId,
        );

        const result: ResumeResult = {
          workflowId,
          checkpoint,
          timestamp: latestRecord.timestamp,
        };

        logger.info(`Resuming from checkpoint "${latestRecord.checkpointId}"`);
        logger.info(JSON.stringify(result, null, 2));
        outro("Resume information loaded");
      } catch (error) {
        logger.error(String(error));
        process.exit(1);
      }
    });
}
