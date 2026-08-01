// packages/storage-sqlite/src/index.ts
export { openDatabase } from "./schema";

export { SqliteExecutionRepository } from "./execution-repository";
export {
  SqliteApprovalManager,
  ApprovalNotFoundError,
  ApprovalStateTransitionError,
  ApprovalExpiredError,
} from "./approval-manager";
export { SqliteExecutionEventStore } from "./event-store";
export {
  SqliteArtifactStore,
  ArtifactConflictError,
  ArtifactNotFoundError,
  ArtifactCycleError,
} from "./artifact-store";
export type { SqliteArtifactStoreOptions } from "./artifact-store";
export {
  SqliteSessionStore,
  SessionAlreadyExistsError,
  SessionNotFoundError,
  SessionConflictError,
} from "./session-store";
