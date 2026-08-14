// packages/agents/src/visual-validation/index.ts
//
// The V2 pre-approval visual evaluation surface. See ./README.md for the
// boundary between what is measured and what is interpreted.
//
// The legacy `visual-validation-agent` is exported from the package root
// directly and is not re-exported here: it belongs to the post-apply Stage 5
// path, and nothing in V2 should reach it by reaching for "visual".
export {
  compileVisualExpectations,
  instrumentationRefFor,
  normalizeText,
  type CompiledExpectations,
} from "./visual-expectation-compiler";

export {
  resolveCorrespondence,
  type CorrespondenceResult,
} from "./element-correspondence";

export {
  evaluateVisualDeltas,
  parseColor,
  type DeltaEvaluation,
} from "./visual-delta-evaluator";

export {
  applyVisualCriticPatches,
  type MergedCriticPatches,
  type CriticPatchFailure,
} from "./critic-patch-merge";

export {
  visualCriticAgentManifest,
  visualCriticDefaultModelProfile,
  partitionCriticFindings,
  compileCriticEvidence,
  toCriticPatch,
  VISUAL_CRITIC_AGENT_ID,
  VISUAL_CRITIC_AGENT_VERSION,
  MAX_CRITIC_OUTPUT_TOKENS,
  MAX_FINDINGS_PER_PARTITION,
  createVisualCriticAgent,
  visualCriticAgent,
  deterministicVisualCriticStrategy,
  modelVisualCriticStrategy,
  type CriticPartition,
  type VisualCriticStrategy,
} from "./visual-critic-agent";

export { criticPatchResponseSchema } from "./critic-patch-response-schema";

export {
  evaluateRenderedState,
  type EvaluateRenderedStateOptions,
  type PreApprovalEvaluation,
  type VisualCriticInvoker,
} from "./pre-approval-evaluation";

export {
  assembleVisualDeltaReport,
  decideVisualOutcome,
  formatVisualDeltaReport,
  pixelComparisonFindings,
  PIXEL_MISMATCH_MAJOR_RATIO,
  PIXEL_MISMATCH_MINOR_RATIO,
  type AssembleVisualDeltaReportInput,
} from "./visual-delta-report";
