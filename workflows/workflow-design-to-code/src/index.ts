// workflows/workflow-design-to-code/src/index.ts
export { designToCodeWorkflowPackage } from "./orchestration/manifest";
export { designToCodeWorkflow, designToCodeApprovalPolicy } from "./orchestration/workflow";

export {
  designToCodeCapabilities,
  analyzeDesignCapability,
  extractDesignTokensCapability,
  createComponentStructureCapability,
  generateCodeCapability,
  validateOutputCapability,
} from "./capabilities";

export { readArtifact, writeArtifact, MissingUpstreamArtifactError } from "./orchestration/artifact-io";

export { evaluateDesignEngineerCriterion } from "./visual-correction/evaluate";

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
} from "./orchestration/types";

export type {
  Framework,
  DesignToCodeInput,
  DesignAnalysis,
  DesignTokens,
  ComponentTree,
  SourceCode,
  ValidationReport,
  CapabilityOutput,
} from "./orchestration/types";

// ── Stage 2: Agent Foundation (internal, not a public worker's workflow) ──
export { designToCodeAgentFoundationWorkflowPackage } from "./orchestration/agent-foundation-manifest";
export { designToCodeAgentFoundationWorkflow } from "./orchestration/agent-foundation-workflow";

export {
  agentFoundationCapabilities,
  prepareFigmaSourceFixtureCapability,
  invokeFigmaSpecificationAgentCapability,
  invokeImplementationAgentCapability,
  invokeVisualValidationAgentCapability,
  storeStage2SummaryCapability,
} from "./orchestration/agent-foundation-capabilities";

export {
  AGENT_FOUNDATION_ARTIFACT_IDS,
  AGENT_FOUNDATION_ARTIFACT_TYPES,
  agentFoundationInputSchema,
  agentInvocationInputSchema,
  figmaSnapshotSeedSchema,
  implementationInvocationInputSchema,
  visualValidationInvocationInputSchema,
  stage2SummarySchema,
} from "./orchestration/agent-foundation-types";

export type {
  AgentFoundationInput,
  AgentInvocationInput,
  FigmaSnapshotSeed,
  ImplementationInvocationInput,
  VisualValidationInvocationInput,
  Stage2Summary,
} from "./orchestration/agent-foundation-types";

// ── Stage 3: Figma Specification (internal/experimental) ─────────
export { designToCodeFigmaSpecificationWorkflowPackage, sharedFigmaSpecificationCapabilities } from "./figma-specification/figma-specification-manifest";
export { designToCodeFigmaSpecificationWorkflow } from "./figma-specification/figma-specification-workflow";
export {
  figmaSpecificationCapabilities,
  storeStage3SummaryCapability,
} from "./figma-specification/figma-specification-capabilities";
export {
  FIGMA_SPECIFICATION_ARTIFACT_IDS,
  FIGMA_SPECIFICATION_ARTIFACT_TYPES,
  figmaSpecificationInputSchema,
  stage3SummarySchema,
} from "./figma-specification/figma-specification-types";

// ── Stage 4: experimental real implementation path ─────────────
export { designToCodeImplementationWorkflowPackage, designToCodeImplementationApprovalPolicy } from "./implementation/implementation-manifest";
export { designToCodeImplementationWorkflow } from "./implementation/implementation-workflow";
export { implementationCapabilities } from "./implementation/implementation-capabilities";
export { implementationSideEffectCapabilities } from "./implementation/implementation-side-effect-capabilities";
export { IMPLEMENTATION_ARTIFACT_IDS, IMPLEMENTATION_ARTIFACT_TYPES, implementationWorkflowInputSchema } from "./implementation/implementation-types";
export type { ImplementationWorkflowInput } from "./implementation/implementation-types";

// ── Stage 6: controlled visual correction feedback loop (internal) ──
export { designToCodeFeedbackLoopWorkflowPackage, designToCodeFeedbackLoopApprovalPolicy } from "./visual-correction/feedback-loop-manifest";
export { designToCodeFeedbackLoopWorkflow } from "./visual-correction/feedback-loop-workflow";
export { feedbackLoopCapabilities, directStage5RevalidationCapability } from "./visual-correction/feedback-loop-capabilities";
export { selectActionableFindings, selectedFindingRecords } from "./visual-correction/feedback-loop-selection";
export { validateCorrectionAgentOutput, correctionToImplementationProposal } from "./visual-correction/feedback-loop-utils";
export { FEEDBACK_LOOP_ARTIFACT_IDS, FEEDBACK_LOOP_ARTIFACT_TYPES, feedbackLoopWorkflowInputSchema, actionableFindingSelectionSchema, proposedCorrectionChangesSchema } from "./visual-correction/feedback-loop-types";
export type { FeedbackLoopWorkflowInput, FeedbackLoopInput, ActionableFindingSelection, ProposedCorrectionChanges } from "./visual-correction/feedback-loop-types";
export { inspectRegisteredProject, projectRootIdentity, deriveImplementationCoveragePlan, validateProposedModules, projectFileHash } from "@designflow/capability-implementation";
export { visualValidationCapabilities } from "./visual-validation/visual-validation-capabilities";
export { VISUAL_VALIDATION_ARTIFACT_IDS, VISUAL_VALIDATION_ARTIFACT_TYPES, visualValidationWorkflowInputSchema, visualValidationSummarySchema, previewRuntimeRecordSchema, screenshotEvidenceCollectionSchema, visualComparisonMetricsSchema } from "./visual-validation/visual-validation-types";
export type { VisualValidationWorkflowInput, VisualValidationSummaryV1, PreviewRuntimeRecordV1, VisualValidationInput, VisualValidationReport, VisualComparisonMetricsV1 } from "./visual-validation/visual-validation-types";
export { DEFAULT_VISUAL_VIEWPORTS, PreviewRuntime, captureWithPreview, compareScreenshotBytes, discoverPreviewCommand, loadOptionalPlaywrightRenderer, makePreviewTarget, RendererUnavailableError } from "./visual-validation/visual-validation-runtime";
export type {
  FigmaSpecificationInput,
  Stage3Summary,
} from "./figma-specification/figma-specification-types";

// ── V2-5 / V2-5.1: pre-approval visual evaluation (internal) ────
export { renderProposedState, comparePixels, RENDERER_VERSION } from "./visual-validation/render-proposed-state";
export type {
  RenderProposedStateOptions,
  RenderProposedStateResult,
  RenderedCapture,
  ReferenceScreenshot,
} from "./visual-validation/render-proposed-state";
export { instrumentProposal, INSTRUMENTATION_ATTRIBUTE } from "./visual-validation/render-instrumentation";
export type { InstrumentationResult } from "./visual-validation/render-instrumentation";
export { designToCodeV2VisualWorkflow, designToCodeV2VisualWorkflowPackage } from "./v2-visual/v2-visual-workflow";
export { v2VisualCapabilities, configuredVisualEvaluator } from "./v2-visual/v2-visual-capabilities";
export type { VisualEvaluator } from "./v2-visual/v2-visual-capabilities";
export { V2_VISUAL_ARTIFACT_IDS, V2_VISUAL_ARTIFACT_TYPES, v2VisualStageInputSchema } from "./v2-visual/v2-visual-types";
export type { V2VisualStageInput } from "./v2-visual/v2-visual-types";

export {
  designToCodeV2ConvergenceWorkflow,
  designToCodeV2ConvergenceWorkflowPackage,
} from "./visual-convergence/visual-convergence-workflow";
export { runVisualConvergenceCapability } from "./visual-convergence/visual-convergence-capability";
export {
  V2_CONVERGENCE_ARTIFACT_IDS,
  V2_CONVERGENCE_ARTIFACT_TYPES,
  v2ConvergenceInputSchema,
  configuredVisualRepairBuilder,
} from "./visual-convergence/visual-convergence-types";
export type {
  V2ConvergenceInput,
  VisualRepairBuilder,
  VisualRepairBuilderResult,
} from "./visual-convergence/visual-convergence-types";
export { acceptanceStatus, actionableFindings, deriveIterationQuality, isActionable } from "./visual-convergence/convergence-policy";
export { compareReports, findingKey } from "./visual-convergence/finding-comparison";
export { SELECTION_POLICY_VERSION, selectBestCandidate } from "./visual-convergence/candidate-selection";
export { compileVisualRepairEvidence } from "./visual-convergence/repair-evidence";
export type { VisualRepairEvidence, RepairFindingEvidence } from "./visual-convergence/repair-evidence";
export { renderConvergenceReport } from "./visual-convergence/convergence-report";

export {
  designToCodeV2FinalizeWorkflow,
  designToCodeV2FinalizeWorkflowPackage,
  designToCodeV2FinalizeApprovalPolicy,
} from "./finalization/finalization-workflow";
export {
  inspectFinalizationProjectCapability,
  resolveSelectedProposalCapability,
  storeFinalReviewCapability,
  storeFinalizationResultCapability,
  unappliedFinalizationResult,
} from "./finalization/finalization-capabilities";
export { v2FinalizeInputSchema } from "./finalization/finalization-types";
export type { V2FinalizeInput } from "./finalization/finalization-types";
export { renderFinalizationReport } from "./finalization/finalization-report";

export {
  designToCodeV2Workflow,
  designToCodeV2WorkflowPackage,
  designToCodeV2ApprovalPolicy,
} from "./flagship/flagship-workflow";
export {
  FINALIZABLE_CONVERGENCE_STATUSES,
  isConvergenceFinalizable,
  validateDestinationBinding,
  flagshipCapabilities,
} from "./flagship/flagship-capabilities";
export {
  DESIGN_TO_CODE_V2_WORKFLOW_ID,
  flagshipInputSchema,
  configuredBlueprintCompiler,
  configuredProjectContextCompiler,
  configuredProjectMapper,
  configuredUiBuilder,
} from "./flagship/flagship-types";
export type {
  FlagshipInput,
  V2BlueprintCompiler,
  V2BlueprintCompilation,
  V2ProjectContextCompiler,
  V2ProjectMapper,
  V2ProjectMapperResult,
  V2UiBuilder,
  V2UiBuilderResult,
} from "./flagship/flagship-types";
