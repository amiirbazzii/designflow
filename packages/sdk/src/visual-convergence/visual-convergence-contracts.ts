// packages/sdk/src/visual-convergence/visual-convergence-contracts.ts
import { z } from "zod";
import { visualOutcomeSchema } from "../visual-validation/rendered-state-contracts";

/**
 * Bounded pre-approval visual convergence (Agent Architecture V2, phase V2-6).
 *
 *   Builder P0 → render → report R0
 *        ↓ (repair required, budget remains)
 *   Builder repair P1 → render from scratch → report R1
 *        ↓
 *   Builder repair P2 → render from scratch → report R2
 *        ↓
 *   deterministic candidate selection → one selected proposal
 *
 * The roles are fixed: the Visual Critic diagnoses, the UI Builder repairs,
 * and the deterministic host decides whether another iteration is allowed.
 * Nothing an agent outputs can raise the iteration limit, and the last
 * proposal is not automatically the selected one.
 *
 * This is deliberately NOT the legacy feedback-loop contract
 * (`design-to-code-feedback-loop`, `maxIterations ≤ 8`). That loop applies
 * approved corrections to the real project between iterations; this one never
 * applies anything — every state is pre-approval, rendered in isolation. The
 * two limits describe different machines, so V2 convergence owns its own
 * canonical limit here rather than borrowing a number whose semantics do not
 * transfer.
 */

export const VISUAL_CONVERGENCE_SCHEMA_VERSION = "1";
export const VISUAL_CONVERGENCE_ARTIFACT_ID = "visual-convergence";
export const VISUAL_CONVERGENCE_ARTIFACT_TYPE = "implementation.visual-convergence";

/**
 * The one canonical source of the V2 convergence budget.
 *
 * `defaultEvaluatedStates` counts *evaluated implementation states*, not
 * repairs: the initial proposal plus at most two visual repairs. The hard
 * maximum is enforced by the host regardless of configuration — a malformed
 * config or an insistent model can lower the budget, never raise it.
 */
export const VISUAL_CONVERGENCE_LIMITS = Object.freeze({
  defaultEvaluatedStates: 3,
  hardMaxEvaluatedStates: 3,
});

export const visualConvergenceStatusSchema = z.enum([
  "converged",
  "converged_with_findings",
  "repair_required",
  "exhausted",
  "inconclusive",
  "render_failed",
  "builder_failed",
  "map_unexecutable",
  "project_changed",
  "cancelled",
]);
export type VisualConvergenceStatus = z.infer<typeof visualConvergenceStatusSchema>;

export const visualConvergenceStopReasonSchema = z.enum([
  "converged",
  "acceptable_with_findings",
  "iteration_limit_reached",
  "no_measurable_improvement",
  "regression_detected",
  "render_inconclusive",
  "render_failed",
  "builder_exhausted",
  "map_unexecutable",
  "project_changed",
  "cancelled",
]);
export type VisualConvergenceStopReason = z.infer<typeof visualConvergenceStopReasonSchema>;

/**
 * How one stable finding moved between two consecutive reports.
 *
 * Findings are correlated by canonical identity (expectation-derived finding
 * id + viewport), never by generated prose.
 */
export const findingDeltaStateSchema = z.enum([
  "resolved",
  "improved",
  "unchanged",
  "regressed",
  "new",
  "incomparable",
]);
export type FindingDeltaState = z.infer<typeof findingDeltaStateSchema>;

export const findingComparisonEntrySchema = z
  .object({
    /** Canonical comparison key: findingId (expectation id + property) + viewport. */
    key: z.string().min(1).max(300),
    state: findingDeltaStateSchema,
    previousDelta: z.number().finite().optional(),
    currentDelta: z.number().finite().optional(),
    severity: z.enum(["info", "minor", "major", "critical"]),
    category: z.string().min(1).max(60),
  })
  .strict();
export type FindingComparisonEntry = z.infer<typeof findingComparisonEntrySchema>;

/** The deterministic verdict over one iteration-to-iteration comparison. */
export const iterationComparisonSchema = z
  .object({
    resolved: z.number().int().nonnegative(),
    improved: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    regressed: z.number().int().nonnegative(),
    introduced: z.number().int().nonnegative(),
    incomparable: z.number().int().nonnegative(),
    previousPixelMismatchRatio: z.number().min(0).max(1).optional(),
    currentPixelMismatchRatio: z.number().min(0).max(1).optional(),
    verdict: z.enum(["improved", "mixed", "no_measurable_improvement", "regressed"]),
    entries: z.array(findingComparisonEntrySchema).max(256).default([]),
  })
  .strict();
export type IterationComparison = z.infer<typeof iterationComparisonSchema>;

/** The measurable quality of one evaluated implementation state. */
export const iterationQualitySchema = z
  .object({
    renderable: z.boolean(),
    missingRequiredCount: z.number().int().nonnegative(),
    criticalCount: z.number().int().nonnegative(),
    majorCount: z.number().int().nonnegative(),
    unresolvedExpectationCount: z.number().int().nonnegative(),
    actionableCount: z.number().int().nonnegative(),
    pixelMismatchRatio: z.number().min(0).max(1).optional(),
  })
  .strict();
export type IterationQuality = z.infer<typeof iterationQualitySchema>;

export const convergenceIterationSchema = z
  .object({
    /** 0 = initial implementation, 1 = repair 1, 2 = repair 2. */
    iteration: z.number().int().nonnegative().max(7),
    /** sha256 of the exact validated proposal this state renders. */
    proposalHash: z.string().min(1).max(200),
    /** The proposal this one repairs; absent on the initial state. */
    repairsProposalHash: z.string().min(1).max(200).optional(),
    proposalRef: z.string().min(1).max(256),
    renderedStateRef: z.string().min(1).max(256),
    reportRef: z.string().min(1).max(256),
    outcome: visualOutcomeSchema,
    quality: iterationQualitySchema,
    /** Against the previous iteration; absent on the initial state. */
    comparison: iterationComparisonSchema.optional(),
    builderAttempts: z.number().int().nonnegative().max(8),
  })
  .strict();
export type ConvergenceIteration = z.infer<typeof convergenceIterationSchema>;

export const visualConvergenceMetricsSchema = z
  .object({
    visualConvergenceIterationCount: z.number().int().nonnegative(),
    visualConvergenceRepairCount: z.number().int().nonnegative(),
    visualConvergenceInitialFindingCount: z.number().int().nonnegative(),
    visualConvergenceFinalFindingCount: z.number().int().nonnegative(),
    visualConvergenceResolvedCount: z.number().int().nonnegative(),
    visualConvergenceImprovedCount: z.number().int().nonnegative(),
    visualConvergenceRegressedCount: z.number().int().nonnegative(),
    visualConvergenceSelectedIteration: z.number().int().nonnegative().optional(),
    visualConvergenceStopReason: visualConvergenceStopReasonSchema,
  })
  .strict();
export type VisualConvergenceMetrics = z.infer<typeof visualConvergenceMetricsSchema>;

/**
 * The canonical record of one bounded convergence run.
 *
 * References only — proposal source and screenshots stay in their own
 * artifacts. `selectedProposalRef` is the single candidate the future approval
 * stage may consider, chosen by the documented deterministic policy; it may be
 * any validated iteration, not necessarily the last.
 */
export const visualConvergenceArtifactSchema = z
  .object({
    schemaVersion: z.literal(VISUAL_CONVERGENCE_SCHEMA_VERSION),
    status: visualConvergenceStatusSchema,
    stopReason: visualConvergenceStopReasonSchema,
    iterationLimit: z
      .number()
      .int()
      .positive()
      .max(VISUAL_CONVERGENCE_LIMITS.hardMaxEvaluatedStates),
    iterationsPerformed: z.number().int().nonnegative().max(VISUAL_CONVERGENCE_LIMITS.hardMaxEvaluatedStates),
    iterations: z.array(convergenceIterationSchema).max(VISUAL_CONVERGENCE_LIMITS.hardMaxEvaluatedStates),
    /** Present when at least one iteration produced a selectable candidate. */
    selectedIteration: z.number().int().nonnegative().optional(),
    selectedProposalRef: z.string().min(1).max(256).optional(),
    selectedProposalHash: z.string().min(1).max(200).optional(),
    selectedRenderedStateRef: z.string().min(1).max(256).optional(),
    selectedVisualDeltaReportRef: z.string().min(1).max(256).optional(),
    /** The documented lexicographic selection policy that chose the candidate. */
    selectionPolicyVersion: z.string().min(1).max(40),
    /** The project fingerprint every selectable proposal is bound to. */
    baseProjectFingerprint: z.string().min(1).max(200).optional(),
    metrics: visualConvergenceMetricsSchema,
    notes: z.array(z.string().min(1).max(400)).max(16).default([]),
  })
  .strict();
export type VisualConvergenceArtifact = z.infer<typeof visualConvergenceArtifactSchema>;
