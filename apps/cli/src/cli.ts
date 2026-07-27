// apps/cli/src/cli.ts
import { Command } from "commander";
import { registerRunCommand } from "./commands/run";
import { registerStatusCommand } from "./commands/status";
import { registerResumeCommand } from "./commands/resume";
import { registerApproveCommand } from "./commands/approve";
import { registerRejectCommand } from "./commands/reject";

export function createCli(): Command {
  const program = new Command();

  program
    .name("wf")
    .description("DesignFlow workflow CLI")
    .version("0.1.0");

  registerRunCommand(program);
  registerStatusCommand(program);
  registerResumeCommand(program);
  registerApproveCommand(program);
  registerRejectCommand(program);

  return program;
}