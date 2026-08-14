// workflows/workflow-design-to-code/src/finalization/finalization-types.ts
import { z } from "zod";
import { visualConvergenceArtifactSchema, type CapabilityContext } from "@designflow/sdk";

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
    convergence: visualConvergenceArtifactSchema,
  })
  .strict();

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
  // Registry-backed stores can resolve a logical artifact id to its payload.
  const registry = context.artifactStore as {
    getArtifact?: (id: string) => Promise<{ metadata?: Record<string, unknown> } | null>;
  };
  const logical = registry.getArtifact === undefined ? null : await registry.getArtifact(ref);
  const payloadId = logical?.metadata?.payloadId;
  if (typeof payloadId !== "string") return undefined;
  const stored = await context.artifactStore.get(payloadId);
  return stored === null ? undefined : stored.data;
}
