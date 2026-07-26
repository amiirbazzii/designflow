import { Command } from "commander";
import { intro, outro, spinner } from "@clack/prompts";
import { LocalApprovalManager } from "@designflow/core";

export function registerRejectCommand(program: Command): void {
  program
    .command("reject")
    .description("Reject a pending approval request")
    .argument("<approval-id>", "Approval ID to reject")
    .option("-c, --comment <comment>", "Optional comment")
    .action(async (approvalId: string, options: { comment?: string }): Promise<void> => {
      intro(`wf reject ${approvalId}`);

      const spin = spinner();
      spin.start("Processing rejection");

      try {
        const manager = new LocalApprovalManager();
        const request = await manager.reject(approvalId, options.comment);

        spin.stop("Rejection processed");

        process.stdout.write(JSON.stringify({
          approvalId: request.id,
          status: request.status,
          resolvedAt: request.resolvedAt,
        }, null, 2) + "\n");

        outro(`Approval ${request.id} rejected`);
      } catch (error) {
        spin.stop("Rejection failed");
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
    });
}