// packages/agents/src/index.ts
import { InMemoryAgentRegistry } from "./registry";
import {
  createDesignEngineerAgent,
  designEngineerAgent,
  type DesignEngineerStrategy,
} from "./catalog/design-engineer-agent";

import {
  createQaReviewerAgent,
  qaReviewerAgent,
  type QaReviewerStrategy,
} from "./catalog/qa-reviewer-agent";

import {
  createResearchAnalystAgent,
  researchAnalystAgent,
  type ResearchAnalystStrategy,
} from "./catalog/research-analyst-agent";

import {
  createProductManagerAgent,
  productManagerAgent,
  type ProductManagerStrategy,
} from "./catalog/product-manager-agent";

import {
  createDesignEngineerCoordinator,
  designEngineerCoordinator,
} from "./catalog/design-engineer-coordinator";

import {
  createFigmaSpecificationAgent,
  figmaSpecificationAgent,
  type FigmaSpecificationStrategy,
} from "./catalog/figma-specification-agent";
import {
  createImplementationAgent,
  implementationAgent,
  type ImplementationStrategy,
} from "./catalog/implementation-agent";
import {
  createVisualValidationAgent,
  visualValidationAgent,
  type VisualValidationStrategy,
} from "./catalog/visual-validation-agent";
import {
  createVisualCorrectionAgent,
  visualCorrectionAgent,
  type VisualCorrectionStrategy,
} from "./catalog/visual-correction-agent";

import { InMemorySpecializedAgentRegistry } from "./specialized-registry";

export { InMemoryAgentRegistry, assertWorkerAgentAlignment } from "./registry";
export { InMemorySpecializedAgentRegistry } from "./specialized-registry";

export { AgentInvocationRuntime } from "./invocation-runtime";
export type { AgentInvocationRuntimeOptions } from "./invocation-runtime";

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
  AgentInvocationRequestInvalidError,
  SpecializedAgentOutputInvalidError,
  CoordinatorOutputAttemptsExhaustedError,
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
  createQaReviewerAgent,
  deterministicQaReviewerStrategy,
  modelQaReviewerStrategy,
} from "./catalog/qa-reviewer-agent";
export type { QaReviewerStrategy } from "./catalog/qa-reviewer-agent";

export {
  researchAnalystAgent,
  researchAnalystAgentManifest,
  researchAnalystDefaultModelProfile,
  createResearchAnalystAgent,
  deterministicResearchAnalystStrategy,
  modelResearchAnalystStrategy,
} from "./catalog/research-analyst-agent";
export type { ResearchAnalystStrategy } from "./catalog/research-analyst-agent";

export {
  productManagerAgent,
  productManagerAgentManifest,
  productManagerDefaultModelProfile,
  createProductManagerAgent,
  deterministicProductManagerStrategy,
  modelProductManagerStrategy,
} from "./catalog/product-manager-agent";
export type { ProductManagerStrategy } from "./catalog/product-manager-agent";

export {
  buildDecisionPrompt,
  decisionResponseSchema,
  modelDecisionFromTransport,
  modelDecisionSchema,
  modelDecisionTransportSchema,
  validateProductActionTransport,
  productActionFromTransport,
  COORDINATOR_OUTPUT_ERROR_CODES,
} from "./decision-prompt";
export type {
  DecisionPromptInput,
  ModelDecision,
  ModelDecisionTransport,
  CoordinatorOutputErrorCode,
  CoordinatorOutputValidationFailure,
  ProductActionDecision,
  ProductActionValidation,
  ProductActionRepairFeedback,
} from "./decision-prompt";

export {
  designEngineerCoordinator,
  designEngineerCoordinatorManifest,
  designEngineerCoordinatorDefaultModelProfile,
  createDesignEngineerCoordinator,
} from "./catalog/design-engineer-coordinator";

export {
  figmaSpecificationAgent,
  figmaSpecificationAgentManifest,
  figmaSpecificationDefaultModelProfile,
  createFigmaSpecificationAgent,
  deterministicFigmaSpecificationStrategy,
  modelFigmaSpecificationStrategy,
} from "./catalog/figma-specification-agent";
export type { FigmaSpecificationStrategy } from "./catalog/figma-specification-agent";

export {
  implementationAgent,
  implementationAgentManifest,
  implementationDefaultModelProfile,
  createImplementationAgent,
  deterministicImplementationStrategy,
  modelImplementationStrategy,
} from "./catalog/implementation-agent";
export type { ImplementationStrategy } from "./catalog/implementation-agent";

export {
  visualValidationAgent,
  visualValidationAgentManifest,
  visualValidationDefaultModelProfile,
  createVisualValidationAgent,
  deterministicVisualValidationStrategy,
  modelVisualValidationStrategy,
} from "./catalog/visual-validation-agent";
export type { VisualValidationStrategy } from "./catalog/visual-validation-agent";

export {
  visualCorrectionAgent,
  visualCorrectionAgentManifest,
  visualCorrectionDefaultModelProfile,
  createVisualCorrectionAgent,
  deterministicVisualCorrectionStrategy,
  modelVisualCorrectionStrategy,
} from "./catalog/visual-correction-agent";
export type { VisualCorrectionStrategy } from "./catalog/visual-correction-agent";

/** Every agent that ships with DesignFlow, in its default (deterministic) form. */
export const BUILT_IN_AGENTS = [
  designEngineerAgent,
  designEngineerCoordinator,
  qaReviewerAgent,
  researchAnalystAgent,
  productManagerAgent,
] as const;

/** Every specialized agent that ships with DesignFlow, in its default (deterministic) form. */
export const BUILT_IN_SPECIALIZED_AGENTS = [
  figmaSpecificationAgent,
  implementationAgent,
  visualValidationAgent,
  visualCorrectionAgent,
] as const;

export interface AgentCatalogOptions {
  /**
   * Which strategy each built-in agent decides with.
   *
   * Each defaults to its deterministic form — offline, no credential
   * required. A host opts into a model-backed strategy explicitly, per
   * agent; nothing here inspects an environment variable or guesses. That
   * choice belongs to the composition root, which is the one place that
   * actually knows whether a model layer was wired in at all, and it makes
   * the choice independently for every agent — one agent's model never
   * decides another's.
   */
  readonly designEngineerStrategy?: DesignEngineerStrategy | undefined;
  /**
   * The coordinator's own strategy option, distinct from
   * `designEngineerStrategy` above.
   *
   * Both default to the identical deterministic logic, but they are two
   * separate agents with two separate ids and two separate model profiles —
   * a host opting a custom coordinator strategy in must not silently also
   * change what the retained `design-engineer-agent` alias does, and a test
   * exercising the alias must not accidentally be exercising the coordinator.
   */
  readonly designEngineerCoordinatorStrategy?: DesignEngineerStrategy | undefined;
  readonly qaReviewerStrategy?: QaReviewerStrategy | undefined;
  readonly researchAnalystStrategy?: ResearchAnalystStrategy | undefined;
  readonly productManagerStrategy?: ProductManagerStrategy | undefined;
}

/** Which strategy each built-in specialized agent decides with. Same defaulting rule as `AgentCatalogOptions`. */
export interface SpecializedAgentCatalogOptions {
  readonly figmaSpecificationStrategy?: FigmaSpecificationStrategy | undefined;
  readonly implementationStrategy?: ImplementationStrategy | undefined;
  readonly visualValidationStrategy?: VisualValidationStrategy | undefined;
  readonly visualCorrectionStrategy?: VisualCorrectionStrategy | undefined;
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

  const qaReviewer =
    options?.qaReviewerStrategy === undefined
      ? qaReviewerAgent
      : createQaReviewerAgent(options.qaReviewerStrategy);

  const researchAnalyst =
    options?.researchAnalystStrategy === undefined
      ? researchAnalystAgent
      : createResearchAnalystAgent(options.researchAnalystStrategy);

  const productManager =
    options?.productManagerStrategy === undefined
      ? productManagerAgent
      : createProductManagerAgent(options.productManagerStrategy);

  // The coordinator is a distinct agent, registered alongside the retained
  // `design-engineer-agent` alias rather than replacing it — see
  // `design-engineer-coordinator.ts`'s module doc.
  const coordinator =
    options?.designEngineerCoordinatorStrategy === undefined
      ? designEngineerCoordinator
      : createDesignEngineerCoordinator(options.designEngineerCoordinatorStrategy);

  return new InMemoryAgentRegistry([
    designEngineer,
    coordinator,
    qaReviewer,
    researchAnalyst,
    productManager,
  ]);
}

/**
 * A registry containing the built-in specialized agents.
 *
 * Fresh per call, for the same isolation reason `createAgentRegistry` is: a
 * host that registers its own specialized agents must not leak them into
 * another caller's registry.
 */
export function createSpecializedAgentRegistry(
  options?: SpecializedAgentCatalogOptions,
): InMemorySpecializedAgentRegistry {
  const figmaSpecification =
    options?.figmaSpecificationStrategy === undefined
      ? figmaSpecificationAgent
      : createFigmaSpecificationAgent(options.figmaSpecificationStrategy);

  const implementation =
    options?.implementationStrategy === undefined
      ? implementationAgent
      : createImplementationAgent(options.implementationStrategy);

  const visualValidation =
    options?.visualValidationStrategy === undefined
      ? visualValidationAgent
      : createVisualValidationAgent(options.visualValidationStrategy);

  const visualCorrection =
    options?.visualCorrectionStrategy === undefined
      ? visualCorrectionAgent
      : createVisualCorrectionAgent(options.visualCorrectionStrategy);

  return new InMemorySpecializedAgentRegistry([
    figmaSpecification,
    implementation,
    visualValidation,
    visualCorrection,
  ]);
}
