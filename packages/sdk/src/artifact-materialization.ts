import { z } from "zod";
import { artifactRefSchema } from "./schemas";

// ── Materialization Request ──────────────────────────────────────

/**
 * What the engine asks a materializer to turn into usable references.
 *
 * `artifactIds` are the ids a `CapabilityReuseResolver` offered in place of
 * running the node — claims, not yet verified.
 */
export const artifactMaterializationRequestSchema = z.object({
  nodeId: z.string().min(1),
  capabilityId: z.string().min(1),
  executionId: z.string().min(1),
  artifactIds: z.array(z.string().min(1)),
});

export type ArtifactMaterializationRequest = z.infer<
  typeof artifactMaterializationRequestSchema
>;

// ── Materialization Result ───────────────────────────────────────

export const artifactMaterializationResultSchema = z.object({
  success: z.boolean(),
  artifacts: z.array(artifactRefSchema).default([]),
  /**
   * The execution that originally produced these artifacts, when every one of
   * them agrees. Absent when they came from different runs or carry no
   * provenance.
   */
  sourceExecutionId: z.string().min(1).optional(),
});

export type ArtifactMaterializationResult = z.infer<
  typeof artifactMaterializationResultSchema
>;

// ── Materializer Contract ────────────────────────────────────────

/**
 * Turns claimed artifact ids into references the engine can safely inject.
 *
 * The division of labour across the incremental loop:
 *
 * | Question | Owner |
 * |---|---|
 * | Does this node need computation? | `IncrementalExecutionPlanner` |
 * | Can we reuse instead of computing? | `CapabilityReuseResolver` |
 * | Are these artifacts real and usable? | `ArtifactMaterializer` |
 *
 * A materializer is strictly read-only: it never executes a capability, never
 * creates an artifact, and never mutates the registry. It validates and
 * resolves.
 *
 * Implementations may report a validation failure either by returning
 * `success: false` or by throwing a `DesignFlowError`; the engine treats both
 * as a failed materialization. Throwing carries the richer diagnostic and is
 * what the bundled implementation does.
 */
export interface ArtifactMaterializer {
  materialize(
    request: ArtifactMaterializationRequest,
  ): Promise<ArtifactMaterializationResult>;
}
