// packages/storage-file/src/index.ts
export { FileStore, hashContent, canonicalize } from "./store";
export type { StoreDocument, StoredPayload } from "./store";
export { CURRENT_STORE_SCHEMA_VERSION, inspectStateFile } from "./state-health";
export type { StateHealthReport, StateHealthStatus } from "./state-health";

export {
  FileExecutionRepository,
  FileApprovalManager,
  FileExecutionEventStore,
  FileArtifactStore,
  FileTraceStore,
  FileSessionStore,
  ApprovalNotFoundError,
  ApprovalStateTransitionError,
  ApprovalExpiredError,
  ArtifactConflictError,
  ArtifactNotFoundError,
  ArtifactCycleError,
  SessionAlreadyExistsError,
  SessionNotFoundError,
  SessionConflictError,
  FileProjectStore,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  FileProjectContextStore,
  ProjectContextNotFoundError,
  ProjectContextConflictError,
  FileAgentMemoryStore,
  MemoryNotFoundError,
  MemoryAlreadyExistsError,
  FileMemoryProposalStore,
  MemoryProposalNotFoundError,
  MemoryProposalAlreadyExistsError,
  MemoryProposalStateInvalidError,
} from "./adapters";
export type { FileArtifactStoreOptions, FileApprovalManagerOptions } from "./adapters";
export {
  FileFeedbackLoopParentStore,
  FeedbackLoopParentAlreadyExistsError,
} from "./feedback-loop-parent-store";
