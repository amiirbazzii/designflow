import { Command } from "commander";
import { intro, outro, spinner } from "@clack/prompts";
import { InMemoryApprovalManager } from "@designflow/core";

export function registerApproveCommand(program: Command): void {
  program
    .command("approve")
    .description("Approve a pending approval request")
    .argument("<approval-id>", "Approval ID to approve")
    .option("-c, --comment <comment>", "Optional comment")
    .action(async (approvalId: string, options: { comment?: string }): Promise<void> => {
      intro(`wf approve ${approvalId}`);

      const spin = spinner();
      spin.start("Processing approval");

      try {
        const manager = new InMemoryApprovalManager();
        const request = await manager.approve(approvalId, options.comment);

        spin.stop("Approval processed");

        process.stdout.write(JSON.stringify({
          approvalId: request.id,
          status: request.status,
          resolvedAt: request.resolvedAt,
        }, null, 2) + "\n");

        outro(`Approval ${request.id} approved`);
      } catch (error) {
        spin.stop("Approval failed");
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
    });
}