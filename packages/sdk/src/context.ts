// packages/sdk/src/context.ts
import type { ArtifactRef } from "./schemas";
import type { ArtifactStore } from "./state";
import type { AgentInvocationService } from "./agent-invocation";

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
  /**
   * The port a capability uses to invoke a registered specialized agent.
   *
   * Optional and absent by default — every capability written before this
   * field existed reads exactly the context it always did. A host that never
   * wires an `AgentInvocationService` (an `ExecutionEngine` built without one,
   * which is every host prior to this stage) leaves this `undefined`, and a
   * capability that calls it anyway is a capability that was written
   * expecting one to be configured.
   */
  readonly agents?: AgentInvocationService;
}