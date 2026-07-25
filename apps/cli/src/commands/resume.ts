import { Command } from "commander";
import { intro, outro, log } from "@clack/prompts";
import { executionCheckpointSchema } from "@designflow/sdk";
import { LocalStateStore } from "@designflow/state";
import type { ResumeResult } from "../types";
import { CliLogger } from "../logger";

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

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
        const latest = await stateStore.getLatestCheckpoint(workflowId);

        if (latest === null) {
          logger.error(`No checkpoints found for workflow "${workflowId}".`);
          process.exit(1);
        }

        const checkpoint = executionCheckpointSchema.parse(latest.state);

        const result: ResumeResult = {
          workflowId,
          checkpoint: latest.checkpointId,
          phase: checkpoint.phase,
          timestamp: latest.timestamp,
        };

        logger.info(`Workflow:     ${result.workflowId}`);
        logger.info(`Checkpoint:   ${result.checkpoint}`);
        logger.info(`Phase:        ${result.phase}`);
        logger.info(`Time:         ${formatTimestamp(result.timestamp)}`);
        outro("Resume point loaded (execution not yet resumed)");
      } catch (error) {
        log.error(String(error));
        process.exit(1);
      }
    });
}
