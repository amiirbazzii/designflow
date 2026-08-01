// workflows/workflow-product-brief/src/index.ts
export { productBriefWorkflowPackage } from "./manifest";
export { productBriefWorkflow, productBriefApprovalPolicy } from "./workflow";

export {
  productBriefCapabilities,
  normalizeProductRequestCapability,
  defineScopeCapability,
  defineRequirementsCapability,
  defineAcceptanceCriteriaCapability,
  assessRisksCapability,
  produceProductBriefCapability,
} from "./capabilities";

export { readArtifact, writeArtifact, MissingUpstreamArtifactError } from "./artifact-io";

export { evaluateProductManagerCriterion } from "./evaluate";

export {
  ARTIFACT_IDS,
  ARTIFACT_TYPES,
  productBriefInputSchema,
  problemStatementSchema,
  scopeDefinitionSchema,
  priorityLevelSchema,
  requirementSchema,
  requirementsSchema,
  acceptanceCriterionSchema,
  acceptanceCriteriaSchema,
  riskEntryKindSchema,
  riskEntrySchema,
  riskAssumptionRegisterSchema,
  productBriefSchema,
  capabilityOutputSchema,
} from "./types";

export type {
  ProductBriefInput,
  ProblemStatement,
  ScopeDefinition,
  PriorityLevel,
  Requirement,
  Requirements,
  AcceptanceCriterion,
  AcceptanceCriteria,
  RiskEntryKind,
  RiskEntry,
  RiskAssumptionRegister,
  ProductBrief,
  CapabilityOutput,
} from "./types";
