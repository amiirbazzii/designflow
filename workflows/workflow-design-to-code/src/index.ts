// workflows/workflow-design-to-code/src/index.ts
export { designToCodeWorkflowPackage } from "./manifest";
export { designToCodeWorkflow, designToCodeApprovalPolicy } from "./workflow";

export {
  designToCodeCapabilities,
  analyzeDesignCapability,
  extractDesignTokensCapability,
  createComponentStructureCapability,
  generateCodeCapability,
  validateOutputCapability,
} from "./capabilities";

export { readArtifact, writeArtifact, MissingUpstreamArtifactError } from "./artifact-io";

export { evaluateDesignEngineerCriterion } from "./evaluate";

export {
  ARTIFACT_IDS,
  ARTIFACT_TYPES,
  frameworkSchema,
  designToCodeInputSchema,
  designAnalysisSchema,
  designTokensSchema,
  componentTreeSchema,
  sourceCodeSchema,
  validationReportSchema,
  capabilityOutputSchema,
} from "./types";

export type {
  Framework,
  DesignToCodeInput,
  DesignAnalysis,
  DesignTokens,
  ComponentTree,
  SourceCode,
  ValidationReport,
  CapabilityOutput,
} from "./types";

// ── Stage 2: Agent Foundation (internal, not a public worker's workflow) ──
export { designToCodeAgentFoundationWorkflowPackage } from "./agent-foundation-manifest";
export { designToCodeAgentFoundationWorkflow } from "./agent-foundation-workflow";

export {
  agentFoundationCapabilities,
  prepareFigmaSourceFixtureCapability,
  invokeFigmaSpecificationAgentCapability,
  invokeImplementationAgentCapability,
  invokeVisualValidationAgentCapability,
  storeStage2SummaryCapability,
} from "./agent-foundation-capabilities";

export {
  AGENT_FOUNDATION_ARTIFACT_IDS,
  AGENT_FOUNDATION_ARTIFACT_TYPES,
  agentFoundationInputSchema,
  agentInvocationInputSchema,
  figmaSnapshotSeedSchema,
  implementationInvocationInputSchema,
  visualValidationInvocationInputSchema,
  stage2SummarySchema,
} from "./agent-foundation-types";

export type {
  AgentFoundationInput,
  AgentInvocationInput,
  FigmaSnapshotSeed,
  ImplementationInvocationInput,
  VisualValidationInvocationInput,
  Stage2Summary,
} from "./agent-foundation-types";
