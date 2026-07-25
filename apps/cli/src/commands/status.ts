import { Command } from "commander";
import { intro, outro, log } from "@clack/prompts";
import { LocalStateStore } from "@designflow/state";
import type { StatusResult } from "../types";
import { CliLogger } from "../logger";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show workflow run status")
    .argument("<workflow-id>", "Workflow ID to check")
    .action(async (workflowId: string): Promise<void> => {
      intro(`wf status ${workflowId}`);

      try {
        const logger = new CliLogger();
        const stateStore = new LocalStateStore();
        const history = await stateStore.listHistory(workflowId);

        const result: StatusResult = {
          workflowId,
          checkpoints: history.map((record) => ({
            checkpointId: record.checkpointId,
            timestamp: record.timestamp,
            metadata: { ...record.metadata },
          })),
        };

        logger.info(JSON.stringify(result, null, 2));
        outro(`Found ${history.length} checkpoint(s)`);
      } catch (error) {
        log.error(String(error));
        process.exit(1);
      }
    });
}
