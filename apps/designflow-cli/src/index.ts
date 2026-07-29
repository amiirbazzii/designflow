// apps/designflow-cli/src/index.ts
export { dispatch } from "./cli";
export { CLI_VERSION } from "./version";
export { createCliContext } from "./services/cli-runner";
export type {
  CliContext,
  CliContextOptions,
  WorkflowInfo,
} from "./services/cli-runner";

export {
  loadConfig,
  saveConfig,
  updateConfig,
  migrateConfig,
  defaultConfig,
  configExists,
  configPath,
  configHome,
  historyDir,
  cacheDir,
  resolveDatabasePath,
  configSchema,
  CONFIG_VERSION,
} from "./services/config";
export type { Config } from "./services/config";

export { initializeHome, homeLayout } from "./services/home";
export type { HomeLayout, HomeState } from "./services/home";

export { explainError, formatError, debugEnabled } from "./ui/errors";
export type { UserFacingError } from "./ui/errors";

export { ScriptedTerminal } from "./ui/terminal";
export type { Terminal } from "./ui/terminal";
