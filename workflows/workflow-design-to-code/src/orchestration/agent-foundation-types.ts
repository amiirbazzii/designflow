// workflows/workflow-design-to-code/src/agent-foundation-types.ts
import { z } from "zod";
import { projectImplementationContextSchema } from "@designflow/sdk";
import { capabilityOutputSchema } from "./types";

/**
 * Types and stable artifact identity for `design-to-code-agent-foundation`.
 *
 * This is Stage 2's proof workflow: it demonstrates specialized-agent
 * invocation and typed artifact handoff without touching the public
 * `design-to-code` workflow or its Stage 1-verified behaviour. It is not
 * wired to any worker — see `workers/design-engineer.ts`, whose `workflows`
 * still names `design-to-code` alone — and is reachable only through a
 * direct workflow-id run or a test harness.
 *
 * The design-specification/generated-implementation/visual-validation-report
 * payload shapes themselves live in `@designflow/sdk`
 * (`design-engineer-contracts.ts`), since they are the validated boundary the
 * generic agent-invocation port needs on both sides. This file only adds
 * what is specific to *this workflow's* wiring: its own input, and the
 * per-node "which agent version/profile does this node's reuse identity
 * depend on" fields.
 */

// ── Per-agent version/profile a node's own input carries ────────

/**
 * What a node invoking one specialized agent must declare about it.
 *
 * Carried as part of the node's own resolved `input` — not read from
 * `context.config` — specifically so it participates in that node's reuse
 * fingerprint. A host resolves the *current* value of these fields from its
 * agent and model-profile registries immediately before starting a run; a
 * later run with a bumped agent version or a different model profile
 * produces a different fingerprint for exactly the node that names it, and
 * for nothing else — see the reuse tests.
 */
export const agentInvocationInputSchema = z
  .object({
    agentVersion: z.string().min(1),
    modelProfileId: z.string().min(1).optional(),
  })
  .strict();

export type AgentInvocationInput = z.infer<typeof agentInvocationInputSchema>;

// ── Workflow input ───────────────────────────────────────────────

export const figmaSnapshotSeedSchema = z
  .object({
    designFile: z.string().min(1),
    frames: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type FigmaSnapshotSeed = z.infer<typeof figmaSnapshotSeedSchema>;

export const agentFoundationInputSchema = z
  .object({
    figmaSnapshotSeed: figmaSnapshotSeedSchema,
    projectContext: projectImplementationContextSchema,
    validationThreshold: z.number().min(0).max(1).default(0.8),
    figmaAgentVersion: z.string().min(1),
    figmaAgentModelProfileId: z.string().min(1).optional(),
    implementationAgentVersion: z.string().min(1),
    implementationAgentModelProfileId: z.string().min(1).optional(),
    visualValidationAgentVersion: z.string().min(1),
    visualValidationAgentModelProfileId: z.string().min(1).optional(),
  })
  .strict();

export type AgentFoundationInput = z.infer<typeof agentFoundationInputSchema>;

// ── Node input shapes (each a projection of the workflow input above) ──

export const implementationInvocationInputSchema = agentInvocationInputSchema.extend({
  projectContext: projectImplementationContextSchema,
});

export type ImplementationInvocationInput = z.infer<
  typeof implementationInvocationInputSchema
>;

export const visualValidationInvocationInputSchema = agentInvocationInputSchema.extend({
  threshold: z.number().min(0).max(1),
});

export type VisualValidationInvocationInput = z.infer<
  typeof visualValidationInvocationInputSchema
>;

// ── Artifact identity ────────────────────────────────────────────

export const AGENT_FOUNDATION_ARTIFACT_IDS = {
  figmaSourceSnapshot: "figma-source-snapshot",
  designSpecification: "design-specification",
  generatedImplementation: "generated-implementation",
  visualValidationReport: "visual-validation-report",
  stage2Summary: "stage-2-summary",
} as const;

export const AGENT_FOUNDATION_ARTIFACT_TYPES = {
  figmaSourceSnapshot: "design.figma-source-snapshot",
  designSpecification: "design.specification",
  generatedImplementation: "code.generated-implementation",
  visualValidationReport: "validation.visual-report",
  stage2Summary: "design.stage-2-summary",
} as const;

// ── Stage 2 summary payload ──────────────────────────────────────

export const stage2SummarySchema = z
  .object({
    designFile: z.string().min(1),
    frameCount: z.number().int().nonnegative(),
    ambiguityCount: z.number().int().nonnegative(),
    proposedFileCount: z.number().int().nonnegative(),
    validationPassed: z.boolean(),
    validationScore: z.number().min(0).max(1),
  })
  .strict();

export type Stage2Summary = z.infer<typeof stage2SummarySchema>;

/** Every capability in this workflow returns exactly one artifact reference. */
export { capabilityOutputSchema };
export type { CapabilityOutput } from "./types";
