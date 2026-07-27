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
