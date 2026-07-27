import type { ArtifactRef, ArtifactLineage, CheckpointRecord } from "./schemas";
import type { ArtifactRegistry } from "./artifact-system";

export type { ExecutionContext } from "./schemas";
export { executionContextSchema } from "./schemas";

export type CheckpointState = unknown;

export interface CheckpointData {
  readonly checkpointId: string;
  readonly workflowId: string;
  readonly state: CheckpointState;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: number;
}

export interface StateStore {
  saveCheckpoint(
    workflowId: string,
    checkpointId: string,
    state: CheckpointState,
    metadata?: Record<string, unknown>,
    timestamp?: number,
  ): Promise<void>;

  loadCheckpoint(
    workflowId: string,
    checkpointId: string,
  ): Promise<CheckpointState>;

  listHistory(workflowId: string): Promise<readonly CheckpointRecord[]>;

  getLatestCheckpoint(workflowId: string): Promise<CheckpointData | null>;
}

export interface ArtifactStore {
  save(
    data: unknown,
    metadata?: Record<string, unknown>,
    lineage?: ArtifactLineage,
  ): Promise<ArtifactRef>;

  get(id: string): Promise<{ artifact: ArtifactRef; data: unknown } | null>;

  exists(id: string): Promise<boolean>;
}

/**
 * An `ArtifactStore` that also serves as the artifact registry: payload
 * storage plus identity, immutable versions, provenance and relationships.
 *
 * The registry half is an *extension* rather than an addition to
 * `ArtifactStore` itself so that payload-only backends (local filesystem,
 * object storage) stay valid stores without implementing lineage.
 */
export interface RegistryArtifactStore extends ArtifactStore, ArtifactRegistry {}