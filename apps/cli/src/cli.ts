import { Command } from "commander";
import { registerRunCommand } from "./commands/run";
import { registerStatusCommand } from "./commands/status";
import { registerResumeCommand } from "./commands/resume";

export function createCli(): Command {
  const program = new Command();

  program
    .name("wf")
    .description("DesignFlow workflow CLI")
    .version("0.1.0");

  registerRunCommand(program);
  registerStatusCommand(program);
  registerResumeCommand(program);

  return program;
}
