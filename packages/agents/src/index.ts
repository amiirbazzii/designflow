// packages/agents/src/index.ts
import { InMemoryAgentRegistry } from "./registry";
import { designEngineerAgent } from "./catalog/design-engineer-agent";

export { InMemoryAgentRegistry, assertWorkerAgentAlignment } from "./registry";

export { AgentRuntime } from "./runtime";
export type { AgentRuntimeOptions } from "./runtime";

export {
  AgentNotFoundError,
  DuplicateAgentError,
  AgentTaskInvalidError,
  AgentDecisionInvalidError,
  AgentWorkflowNotAllowedError,
  AgentWorkflowUnavailableError,
} from "./errors";

export {
  designEngineerAgent,
  designEngineerAgentManifest,
} from "./catalog/design-engineer-agent";

/** Every agent that ships with DesignFlow. */
export const BUILT_IN_AGENTS = [designEngineerAgent] as const;

/**
 * A registry containing the built-in agents.
 *
 * A fresh registry per call rather than a shared singleton, for the same
 * reason `createWorkerRegistry` is: a host that registers its own agents must
 * not leak them into another, and a leaked registration is a confusing test
 * failure two files away.
 */
export function createAgentRegistry(): InMemoryAgentRegistry {
  return new InMemoryAgentRegistry(BUILT_IN_AGENTS);
}
