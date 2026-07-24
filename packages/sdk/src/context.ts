import type { ArtifactRef } from "./schemas.ts";

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface CapabilityContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly logger: Logger;
  readonly artifactRefs: readonly ArtifactRef[];
  readonly config: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}