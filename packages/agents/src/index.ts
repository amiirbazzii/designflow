// packages/agents/src/index.ts
import { InMemoryAgentRegistry } from "./registry";
import {
  createDesignEngineerAgent,
  designEngineerAgent,
} from "./catalog/design-engineer-agent";
import type { DesignEngineerStrategy } from "./catalog/design-engineer-agent";

export { InMemoryAgentRegistry, assertWorkerAgentAlignment } from "./registry";

export { AgentRuntime } from "./runtime";
export type { AgentRuntimeOptions } from "./runtime";

export {
  AgentScopedToolService,
  EMPTY_TOOL_SERVICE,
  DEFAULT_MAX_TOOL_CALLS_PER_DECISION,
} from "./tool-service";
export type { AgentScopedToolServiceOptions } from "./tool-service";

export {
  AgentScopedModelService,
  EMPTY_MODEL_SERVICE,
  DEFAULT_MAX_MODEL_CALLS_PER_DECISION,
} from "./model-service";
export type {
  AgentScopedModelServiceOptions,
  ObservedModelStart,
  ObservedModelCall,
} from "./model-service";

export { AGENT_ERROR_CODES } from "./errors";

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
  designEngineerDefaultModelProfile,
  createDesignEngineerAgent,
  deterministicDesignEngineerStrategy,
  modelDesignEngineerStrategy,
} from "./catalog/design-engineer-agent";
export type { DesignEngineerStrategy } from "./catalog/design-engineer-agent";

export {
  qaReviewerAgent,
  qaReviewerAgentManifest,
  qaReviewerDefaultModelProfile,
} from "./catalog/qa-reviewer-agent";

export {
  buildDecisionPrompt,
  decisionResponseSchema,
  modelDecisionSchema,
} from "./decision-prompt";
export type { DecisionPromptInput, ModelDecision } from "./decision-prompt";

/** Every agent that ships with DesignFlow, in its default (deterministic) form. */
export const BUILT_IN_AGENTS = [designEngineerAgent] as const;

export interface AgentCatalogOptions {
  /**
   * Which strategy the Design Engineer decides with.
   *
   * Defaults to the deterministic one — offline, no credential required,
   * unchanged since Stage 36. A host opts into `modelDesignEngineerStrategy`
   * explicitly; nothing here inspects an environment variable or guesses.
   * That choice belongs to the composition root, which is the one place that
   * actually knows whether a model layer was wired in at all.
   */
  readonly designEngineerStrategy?: DesignEngineerStrategy | undefined;
}

/**
 * A registry containing the built-in agents.
 *
 * A fresh registry per call rather than a shared singleton, for the same
 * reason `createWorkerRegistry` is: a host that registers its own agents must
 * not leak them into another, and a leaked registration is a confusing test
 * failure two files away.
 */
export function createAgentRegistry(options?: AgentCatalogOptions): InMemoryAgentRegistry {
  // The shared singleton when no strategy is named, so a caller that never
  // asked for model mode gets the same object identity Stage 36 always
  // returned. A custom strategy gets a fresh instance, since it is by
  // definition not the default.
  const designEngineer =
    options?.designEngineerStrategy === undefined
      ? designEngineerAgent
      : createDesignEngineerAgent(options.designEngineerStrategy);

  return new InMemoryAgentRegistry([designEngineer]);
}
