// apps/designflow-cli/src/index.ts
export { dispatch } from "./cli";
export { CLI_VERSION } from "./version";
export { createCliContext } from "./services/cli-runner";
export type {
  CliContext,
  CliContextOptions,
  AiConnectionStatus,
  WorkflowInfo,
  CleanupReport,
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
  authDir,
  authSessionPath,
  resolveDatabasePath,
  configSchema,
  CONFIG_VERSION,
} from "./services/config";
export type { Config } from "./services/config";

export {
  AuthSessionService,
  AuthSessionError,
  authSessionSchema,
} from "./services/auth-session";
export type {
  AuthClient,
  AuthFailureCode,
  AuthSession,
  AuthSessionSnapshot,
  AuthSessionStatus,
  SupabaseSessionLike,
} from "./services/auth-session";

export { SupabaseAuthClient } from "./services/supabase-auth";
export type { SupabaseAuthClientOptions } from "./services/supabase-auth";
export {
  createOAuthCallbackServer,
  OAuthCallbackError,
  GOOGLE_CALLBACK_HOST,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CALLBACK_PORT,
} from "./services/oauth-callback";
export type {
  OAuthCallbackFailureCode,
  OAuthCallbackResult,
  OAuthCallbackServer,
  OAuthCallbackServerOptions,
} from "./services/oauth-callback";
export {
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  readSupabasePublicConfig,
} from "./services/supabase-config";
export type { SupabasePublicConfig } from "./services/supabase-config";

export { initializeHome, homeLayout } from "./services/home";
export type { HomeLayout, HomeState } from "./services/home";

export { explainError, formatError, debugEnabled } from "./ui/errors";
export type { UserFacingError } from "./ui/errors";

export { ScriptedTerminal } from "./ui/terminal";
export type { Terminal } from "./ui/terminal";
export {
  buildSessionView,
  buildSessionViewFromContext,
  buildSessionRuntimeFromContext,
  setDesignSelection,
  setDestinationSelection,
  setActiveStage,
  DESIGNFLOW_WORKFLOW_STAGES,
} from "./ui/tui/model";
export type {
  DesignFlowSessionView,
  OutputView,
  OutputKind,
  OutputViewerType,
  SessionViewFacts,
  ViewStatus,
  WorkflowStageView,
} from "./ui/tui/model";
export {
  initialNavigationState,
  navigateBack,
  moveListSelection,
  keepSelectionVisible,
  updateUrlText,
  backspaceUrlText,
  deleteUrlText,
  moveUrlCursor,
} from "./ui/tui/navigation";
export type { TuiNavigationState, TuiView } from "./ui/tui/navigation";
