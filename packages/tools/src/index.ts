// packages/tools/src/index.ts
import { InMemoryToolRegistry } from "./registry";
import { classifyDesignTaskTool } from "./catalog/classify-design-task";
import { createProjectSummaryTool } from "./catalog/project-summary";
import { classifyReviewTargetTool } from "./catalog/classify-review-target";
import { summarizeArtifactSetTool } from "./catalog/summarize-artifact-set";
import { accessibilityChecklistTool } from "./catalog/accessibility-checklist";
import { classifyResearchRequestTool } from "./catalog/classify-research-request";
import { validateSourceMetadataTool } from "./catalog/validate-source-metadata";
import { extractStructuredClaimsTool } from "./catalog/extract-structured-claims";
import { classifyProductRequestTool } from "./catalog/classify-product-request";
import { identifyRequirementGapsTool } from "./catalog/identify-requirement-gaps";
import { structureAcceptanceCriteriaTool } from "./catalog/structure-acceptance-criteria";
import type { Tool } from "@designflow/sdk";

export { InMemoryToolRegistry } from "./registry";

export { ToolRuntime } from "./runtime";
export type { ToolRuntimeOptions } from "./runtime";

export {
  TOOL_ERROR_CODES,
  ToolNotFoundError,
  DuplicateToolError,
  ToolCallInvalidError,
  ToolResultInvalidError,
} from "./errors";
export type { ToolErrorCode } from "./errors";

export {
  classifyDesignTaskTool,
  classifyDesignTaskManifest,
  classifyDesignTaskInputSchema,
  classifyDesignTaskOutputSchema,
  designTaskTypeSchema,
} from "./catalog/classify-design-task";
export type {
  ClassifyDesignTaskInput,
  ClassifyDesignTaskOutput,
  DesignTaskType,
} from "./catalog/classify-design-task";

export {
  createProjectSummaryTool,
  projectSummaryManifest,
  projectSummaryInputSchema,
  projectSummaryOutputSchema,
} from "./catalog/project-summary";
export type {
  ProjectSummaryInput,
  ProjectSummaryOutput,
  ProjectSummaryToolOptions,
} from "./catalog/project-summary";

export { createProjectInspector } from "./catalog/project-inspector";
export type { ProjectInspector, ProjectInspectionResult, ProjectFactCandidate } from "./catalog/project-inspector";

// ── QA Reviewer's tools ─────────────────────────────────────────
export {
  classifyReviewTargetTool,
  classifyReviewTargetManifest,
  classifyReviewTargetInputSchema,
  classifyReviewTargetOutputSchema,
  reviewTargetTypeSchema,
} from "./catalog/classify-review-target";
export type {
  ClassifyReviewTargetInput,
  ClassifyReviewTargetOutput,
  ReviewTargetType,
} from "./catalog/classify-review-target";

export {
  summarizeArtifactSetTool,
  summarizeArtifactSetManifest,
  summarizeArtifactSetInputSchema,
  summarizeArtifactSetOutputSchema,
} from "./catalog/summarize-artifact-set";
export type {
  SummarizeArtifactSetInput,
  SummarizeArtifactSetOutput,
  ArtifactItem,
} from "./catalog/summarize-artifact-set";

export {
  accessibilityChecklistTool,
  accessibilityChecklistManifest,
  accessibilityChecklistInputSchema,
  accessibilityChecklistOutputSchema,
  accessibilityCategorySchema,
  accessibilityStatusSchema,
} from "./catalog/accessibility-checklist";
export type {
  AccessibilityChecklistInput,
  AccessibilityChecklistOutput,
  AccessibilityCategory,
  AccessibilityStatus,
  AccessibilityChecklistEntry,
} from "./catalog/accessibility-checklist";

// ── Research Analyst's tools ────────────────────────────────────
export {
  classifyResearchRequestTool,
  classifyResearchRequestManifest,
  classifyResearchRequestInputSchema,
  classifyResearchRequestOutputSchema,
  researchDepthSchema,
} from "./catalog/classify-research-request";
export type {
  ClassifyResearchRequestInput,
  ClassifyResearchRequestOutput,
  ResearchDepth,
} from "./catalog/classify-research-request";

export {
  validateSourceMetadataTool,
  validateSourceMetadataManifest,
  validateSourceMetadataInputSchema,
  validateSourceMetadataOutputSchema,
} from "./catalog/validate-source-metadata";
export type {
  ValidateSourceMetadataInput,
  ValidateSourceMetadataOutput,
  SupplierSource,
  SourceIssue,
  SourceValidationResult,
} from "./catalog/validate-source-metadata";

export {
  extractStructuredClaimsTool,
  extractStructuredClaimsManifest,
  extractStructuredClaimsInputSchema,
  extractStructuredClaimsOutputSchema,
} from "./catalog/extract-structured-claims";
export type {
  ExtractStructuredClaimsInput,
  ExtractStructuredClaimsOutput,
  ExtractedClaim,
} from "./catalog/extract-structured-claims";

// ── Product Manager's tools ─────────────────────────────────────
export {
  classifyProductRequestTool,
  classifyProductRequestManifest,
  classifyProductRequestInputSchema,
  classifyProductRequestOutputSchema,
  productRequestTypeSchema,
} from "./catalog/classify-product-request";
export type {
  ClassifyProductRequestInput,
  ClassifyProductRequestOutput,
  ProductRequestType,
} from "./catalog/classify-product-request";

export {
  identifyRequirementGapsTool,
  identifyRequirementGapsManifest,
  identifyRequirementGapsInputSchema,
  identifyRequirementGapsOutputSchema,
} from "./catalog/identify-requirement-gaps";
export type {
  IdentifyRequirementGapsInput,
  IdentifyRequirementGapsOutput,
  RequirementInput,
  RequirementGap,
} from "./catalog/identify-requirement-gaps";

export {
  structureAcceptanceCriteriaTool,
  structureAcceptanceCriteriaManifest,
  structureAcceptanceCriteriaInputSchema,
  structureAcceptanceCriteriaOutputSchema,
  acceptanceCriteriaFormatSchema,
} from "./catalog/structure-acceptance-criteria";
export type {
  StructureAcceptanceCriteriaInput,
  StructureAcceptanceCriteriaOutput,
  AcceptanceCriteriaFormat,
} from "./catalog/structure-acceptance-criteria";

export interface ToolCatalogOptions {
  /**
   * The directory `project-summary` is allowed to read.
   *
   * Optional, and the catalogue is smaller without it. A host that does not
   * say which directory may be inspected does not get a tool that inspects
   * directories — safer than defaulting to `process.cwd()` and hoping the
   * caller meant it.
   */
  readonly projectRoot?: string | undefined;
}

/**
 * The tools that ship with DesignFlow.
 *
 * A function rather than a constant because one of them needs a root, and a
 * constant would have to invent one.
 */
export function builtInTools(options?: ToolCatalogOptions): readonly Tool[] {
  const tools: Tool[] = [
    classifyDesignTaskTool,
    classifyReviewTargetTool,
    summarizeArtifactSetTool,
    accessibilityChecklistTool,
    classifyResearchRequestTool,
    validateSourceMetadataTool,
    extractStructuredClaimsTool,
    classifyProductRequestTool,
    identifyRequirementGapsTool,
    structureAcceptanceCriteriaTool,
  ];

  if (options?.projectRoot !== undefined) {
    tools.push(createProjectSummaryTool({ root: options.projectRoot }));
  }

  return tools;
}

/**
 * A registry containing the built-in tools.
 *
 * A fresh registry per call rather than a shared singleton, for the same
 * reason `createWorkerRegistry` and `createAgentRegistry` are: a host that
 * registers its own tools must not leak them into another.
 */
export function createToolRegistry(
  options?: ToolCatalogOptions,
): InMemoryToolRegistry {
  return new InMemoryToolRegistry(builtInTools(options));
}
