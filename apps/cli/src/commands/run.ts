import { Command } from "commander";
import { intro, outro, spinner, log } from "@clack/prompts";
import type { WorkflowDefinition } from "@designflow/sdk";
import { testArtifactCapability, testWorkflow } from "@designflow/workflow-test";
import type { RunResult } from "../types";
import { createCliContext } from "../context";

// Temporary Stage 6 registration.
// Replace with workflow discovery mechanism later.
const workflows: Record<string, { definition: WorkflowDefinition; register: (registry: import("@designflow/core").CapabilityRegistry) => void }> = {
  "test-workflow": {
    definition: testWorkflow,
    register(registry) {
      registry.register(testArtifactCapability);
    },
  },
};

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

        const entry = workflows[workflowName];
        if (!entry) {
          spin.stop(`Unknown workflow: ${workflowName}`);
          log.error(`Available workflows: ${Object.keys(workflows).join(", ")}`);
          process.exit(1);
        }

        entry.register(ctx.registry);

        spin.stop("Execution context ready");

        log.info(`Workflow: ${workflowName}`);
        log.info(`Run ID: ${ctx.executionContext.runId}`);

        spin.start("Executing workflow");
        const result = await ctx.engine.run(entry.definition, ctx.executionContext);
        spin.stop("Execution complete");

        const runResult: RunResult = {
          workflowId: workflowName,
          runId: ctx.executionContext.runId,
          status: result.success ? "completed" : "failed",
        };

        if (result.success) {
          log.info(`Artifacts produced: ${result.artifacts.length}`);
          for (const artifact of result.artifacts) {
            log.info(`  ${artifact.id} (${artifact.type})`);
          }
        } else {
          log.error(`Execution failed: ${String(result.error)}`);
        }

        ctx.logger.info(JSON.stringify(runResult, null, 2));
        outro(`Run ${result.success ? "completed" : "failed"}`);
        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        spin.stop("Execution failed");
        log.error(String(error));
        process.exit(1);
      }
    });
}
