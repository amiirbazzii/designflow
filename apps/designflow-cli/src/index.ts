// apps/designflow-cli/src/index.ts
export { dispatch, CLI_VERSION } from "./cli";
export { createCliContext } from "./services/cli-runner";
export type {
  CliContext,
  CliContextOptions,
  WorkflowInfo,
} from "./services/cli-runner";

export {
  loadConfig,
  ensureConfig,
  saveConfig,
  configPath,
  configHome,
  resolveDatabasePath,
  configSchema,
} from "./services/config";
export type { Config } from "./services/config";

export { ScriptedTerminal } from "./ui/terminal";
export type { Terminal } from "./ui/terminal";
