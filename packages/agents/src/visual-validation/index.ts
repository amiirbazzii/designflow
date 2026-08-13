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
  normalizeText,
  type CompiledExpectations,
} from "./visual-expectation-compiler";

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
  type CriticPartition,
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
  type AssembleVisualDeltaReportInput,
} from "./visual-delta-report";
