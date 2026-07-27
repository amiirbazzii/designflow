// packages/sdk/src/context.ts
import type { ArtifactRef } from "./schemas";
import type { ArtifactStore } from "./state";

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface CapabilityContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly capabilityId: string;
  readonly logger: Logger;
  readonly artifactRefs: readonly ArtifactRef[];
  readonly parentArtifacts: readonly ArtifactRef[];
  readonly artifactStore: ArtifactStore;
  readonly config: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}