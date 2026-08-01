// workflows/workflow-research-analysis/src/index.ts
export { researchAnalysisWorkflowPackage } from "./manifest";
export {
  researchAnalysisWorkflow,
  researchAnalysisApprovalPolicy,
} from "./workflow";

export {
  researchAnalysisCapabilities,
  normalizeResearchQuestionCapability,
  extractClaimsCapability,
  compareFindingsCapability,
  summarizeFindingsCapability,
  produceResearchBriefCapability,
} from "./capabilities";

export { readArtifact, writeArtifact, MissingUpstreamArtifactError } from "./artifact-io";

export { evaluateResearchAnalystCriterion } from "./evaluate";

export {
  ARTIFACT_IDS,
  ARTIFACT_TYPES,
  sourceInputSchema,
  researchAnalysisInputSchema,
  validSourceSchema,
  invalidSourceSchema,
  sourceInventorySchema,
  claimSchema,
  extractedClaimsSchema,
  agreementSchema,
  comparisonGroupSchema,
  comparisonMatrixSchema,
  confidenceSchema,
  keyFindingSchema,
  findingsSummarySchema,
  citationSchema,
  conflictSchema,
  researchBriefSchema,
  capabilityOutputSchema,
} from "./types";

export type {
  SourceInput,
  ResearchAnalysisInput,
  ValidSource,
  InvalidSource,
  SourceInventory,
  Claim,
  ExtractedClaims,
  Agreement,
  ComparisonGroup,
  ComparisonMatrix,
  Confidence,
  KeyFinding,
  FindingsSummary,
  Citation,
  Conflict,
  ResearchBrief,
  CapabilityOutput,
} from "./types";
