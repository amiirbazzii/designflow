// workflows/workflow-design-to-code/src/visual-convergence/visual-convergence-types.ts
import { z } from "zod";
import {
  VISUAL_CONVERGENCE_LIMITS,
  type ImplementationMap,
  type ProposedFileChanges,
  type UIBlueprint,
} from "@designflow/sdk";

import { v2VisualStageInputSchema } from "../v2-visual/v2-visual-types";

/**
 * The internal V2 convergence stage (V2-6).
 *
 * Same posture as the V2-5.1 visual stage: internal, pre-approval, and
 * executable through real workflow/artifact interfaces. The flagship
 * `designflow run design-engineer` path is unchanged.
 */
export const V2_CONVERGENCE_ARTIFACT_IDS = {
  convergence: "visual-convergence",
} as const;

export const V2_CONVERGENCE_ARTIFACT_TYPES = {
  convergence: "implementation.visual-convergence",
} as const;

export const v2ConvergenceInputSchema = v2VisualStageInputSchema.extend({
  /**
   * Evaluated implementation states this run may spend. Clamped by the host to
   * the canonical hard maximum — configuration can lower the budget, never
   * raise it.
   */
  maxEvaluatedStates: z
    .number()
    .int()
    .positive()
    .max(VISUAL_CONVERGENCE_LIMITS.hardMaxEvaluatedStates)
    .optional(),
});

export type V2ConvergenceInput = z.infer<typeof v2ConvergenceInputSchema>;

/**
 * The Builder seam.
 *
 * The UI Builder lives in the agents package, which this workflow must not
 * import, so it arrives injected through `context.config.visualRepairBuilder`
 * — exactly the way the browser renderer and the visual evaluator already do.
 * The host still owns iteration: this function is asked for exactly one
 * validated repair proposal, and nothing it returns can extend the loop.
 */
export interface VisualRepairBuilderResult {
  readonly status: "valid" | "exhausted" | "unavailable" | "map_unexecutable" | "stale_project";
  readonly proposal?: ProposedFileChanges;
  readonly attempts: number;
  readonly reason?: string;
}

export interface VisualRepairBuilder {
  (input: {
    readonly blueprint: UIBlueprint;
    readonly implementationMap: ImplementationMap;
    /** The validated proposal being repaired — context, never a base to apply. */
    readonly previousProposal: ProposedFileChanges;
    /** Host-compiled, finding-scoped repair evidence. */
    readonly repairEvidence: unknown;
    /** 1-based repair number within this convergence run. */
    readonly repairNumber: number;
  }): Promise<VisualRepairBuilderResult>;
}

export function configuredVisualRepairBuilder(value: unknown): VisualRepairBuilder | undefined {
  return typeof value === "function" ? (value as VisualRepairBuilder) : undefined;
}
