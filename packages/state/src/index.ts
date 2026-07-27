// packages/state/src/index.ts
export const STATE_VERSION = "0.1.0";

export { LocalStateStore } from "./local";
export { LocalExecutionRepository } from "./local-execution-repository";
export { StateErrorCodes } from "./types";
export type { StoredCheckpoint } from "./types";
