// workflows/workflow-design-to-code/src/finalization/finalization-types.ts
import { z } from "zod";
import {
  DesignFlowError,
  VISUAL_CONVERGENCE_ARTIFACT_ID,
  visualConvergenceArtifactSchema,
  type CapabilityContext,
  type VisualConvergenceArtifact,
} from "@designflow/sdk";

import { readArtifact } from "../orchestration/artifact-io";

/**
 * The internal V2 finalization stage (V2-7).
 *
 * Input is the convergence record plus the registered project. The stage never
 * chooses a candidate — V2-6 already did — and never calls a model. The public
 * flagship path is unchanged.
 */
export const v2FinalizeInputSchema = z
  .object({
    project: z.object({ id: z.string().min(1), name: z.string().min(1), rootPath: z.string().min(1) }).strict(),
    stateDirectory: z.string().min(1),
    /**
     * The convergence record, inline when finalization runs standalone.
     * Absent in the flagship workflow, where the convergence node already
     * persisted it — `resolveConvergence` then reads the artifact instead.
     */
    convergence: visualConvergenceArtifactSchema.optional(),
  })
  .passthrough();

/** The convergence record: from the input, or from the artifact lineage. */
export async function resolveConvergence(
  context: CapabilityContext,
  input: V2FinalizeInput,
): Promise<VisualConvergenceArtifact> {
  if (input.convergence !== undefined) return input.convergence;
  try {
    return visualConvergenceArtifactSchema.parse(
      await readArtifact(context, VISUAL_CONVERGENCE_ARTIFACT_ID, visualConvergenceArtifactSchema),
    );
  } catch {
    throw new DesignFlowError(
      "ERR_CONVERGENCE_NOT_SELECTABLE",
      "No visual convergence record was provided or produced; nothing can be finalized.",
      { capabilityId: context.capabilityId },
    );
  }
}

export type V2FinalizeInput = z.infer<typeof v2FinalizeInputSchema>;

/**
 * Resolves a convergence proposal ref to its stored payload.
 *
 * A ref is either a payload id (repair proposals) or a logical artifact id
 * (iteration 0's seeded proposal); both come from the artifact store, never
 * from anything an agent said.
 */
export async function resolveStoredPayload(
  context: CapabilityContext,
  ref: string,
): Promise<unknown | undefined> {
  const direct = await context.artifactStore.get(ref);
  if (direct !== null) return direct.data;

  // A logical artifact id resolves through this node's own upstream refs —
  // the flagship chain produced it earlier in the same execution, and the
  // ref's metadata names the stored payload. Engine-agnostic, unlike a
  // registry lookup, which not every store surface exposes the same way.
  const upstream = [...context.parentArtifacts].reverse().find((artifact) => artifact.id === ref);
  const upstreamPayloadId = upstream?.metadata?.["payloadId"];
  if (typeof upstreamPayloadId === "string") {
    const stored = await context.artifactStore.get(upstreamPayloadId);
    if (stored !== null) return stored.data;
  }

  // Registry-backed stores can also resolve a logical artifact id directly.
  const registry = context.artifactStore as {
    getArtifact?: (id: string) => Promise<{ metadata?: Record<string, unknown> } | null>;
  };
  const logical = registry.getArtifact === undefined ? null : await registry.getArtifact(ref);
  const payloadId = logical?.metadata?.payloadId;
  if (typeof payloadId !== "string") return undefined;
  const stored = await context.artifactStore.get(payloadId);
  return stored === null ? undefined : stored.data;
}
