// packages/agents/src/ui-builder/index.ts
//
// The V2 implementation executor. See ./README.md for the boundary.
export {
  createUIBuilderAgent,
  uiBuilderAgent,
  uiBuilderAgentManifest,
  uiBuilderDefaultModelProfile,
  deterministicUIBuilderStrategy,
  modelUIBuilderStrategy,
  ImplementationMapUnexecutableError,
  UI_BUILDER_AGENT_ID,
  UI_BUILDER_AGENT_VERSION,
  MAX_BUILDER_OUTPUT_TOKENS,
  type UIBuilderStrategy,
  type UIBuilderInput,
  type UIBuilderMode,
} from "./ui-builder-agent";

export {
  compileUIBuilderEvidence,
  type BuilderEvidenceBundle,
  type CompileBuilderEvidenceOptions,
} from "./builder-evidence-compiler";

export {
  selectBuilderSourcePaths,
  allowedWritePaths,
  boundExcerpt,
  MAX_SOURCE_EXCERPT_BYTES,
  MAX_SELECTED_SOURCE_FILES,
  type BuilderSourceExcerpt,
  type SelectedSourcePath,
} from "./builder-source-selection";

export { enforceImplementationMap, type MapViolation, type MapViolationCode } from "./map-enforcement";

export {
  deriveBuilderCoverage,
  checkReachability,
  type BuilderCoverageEntry,
  type BuilderCoverageResult,
  type ReachabilityResult,
} from "./builder-coverage";

export {
  buildImplementation,
  MAX_BUILDER_ATTEMPTS,
  type BuildImplementationOptions,
  type BuildResult,
  type BuildStatus,
  type ProposedStateOutcome,
} from "./builder-pipeline";

export {
  violationFeedback,
  coverageFeedback,
  reachabilityFeedback,
  buildFeedback,
  repairInstruction,
  type BuilderAttemptFailure,
  type BuilderFailureCode,
} from "./repair-context";

export { builderProposalResponseSchema } from "./proposal-response-schema";
export { renderBuilderReport, type BuilderReportSection } from "./builder-report";
