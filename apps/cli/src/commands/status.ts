// apps/cli/src/commands/status.ts
import { Command } from "commander";
import { intro, outro, log } from "@clack/prompts";
import { executionCheckpointSchema } from "@designflow/sdk";
import { LocalStateStore } from "@designflow/state";
import type { StatusResult } from "../types";
import { CliLogger } from "../logger";
import { createWorkflowLoader } from "../workflows/loader";

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

function statusLabel(phase: string): string {
  switch (phase) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "started":
    case "executing":
      return "running";
    default:
      return "unknown";
  }
}

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
        const latest = await stateStore.getLatestCheckpoint(workflowId);

        if (latest === null) {
          logger.info(`No execution history found for "${workflowId}"`);
          outro("No checkpoints");
          return;
        }

        const checkpoint = executionCheckpointSchema.parse(latest.state);

        let workflowName = workflowId;
        let workflowVersion = "unknown";
        try {
          const registry = await createWorkflowLoader();
          const manifest = registry.get(workflowId);
          if (manifest) {
            workflowName = manifest.name;
            workflowVersion = manifest.version;
          }
        } catch {
          // Workflow may not be available; continue with ID
        }

        const result: StatusResult = {
          workflowId,
          phase: checkpoint.phase,
          timestamp: checkpoint.timestamp,
          status: statusLabel(checkpoint.phase),
        };

        logger.info(`Workflow: ${workflowName} v${workflowVersion}`);
        logger.info(`Phase:    ${result.phase}`);
        logger.info(`Time:     ${formatTimestamp(result.timestamp)}`);
        logger.info(`Status:   ${result.status}`);
        outro(`Checkpoint: ${latest.checkpointId}`);
      } catch (error) {
        log.error(String(error));
        process.exit(1);
      }
    });
}
