// workflows/workflow-research-analysis/src/types.ts
import { z } from "zod";

/**
 * Domain contracts for the Research Analysis workflow.
 *
 * Every artifact payload is validated at both ends: the capability that writes
 * it parses before saving, and the capability that reads it parses after
 * loading. Nodes never hand each other values — the artifact store is the only
 * channel between them, so a schema mismatch surfaces as a validation error
 * rather than a wrong result.
 *
 * This workflow does **not** browse the web. Every source it can ever cite is
 * supplied up front in the workflow input — a bounded, explicit list — and
 * every downstream artifact only ever narrows or reorganizes that list. There
 * is no capability here that fetches a URL.
 */

// ── Workflow Input ───────────────────────────────────────────────

export const sourceInputSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    url: z.string().optional(),
    /** Full text of the source, when available. */
    content: z.string().optional(),
    /** A short excerpt, used when the full content is not supplied. */
    excerpt: z.string().optional(),
    author: z.string().optional(),
    publishedAt: z.string().optional(),
  })
  .strict();

export type SourceInput = z.infer<typeof sourceInputSchema>;

export const researchAnalysisInputSchema = z
  .object({
    /** The research question every downstream artifact answers to. */
    question: z.string().min(1),
    /**
     * The bounded, caller-supplied source list. Nothing outside this array is
     * ever read — there is no fetch step anywhere in this workflow.
     */
    sources: z.array(sourceInputSchema).default([]),
  })
  .strict();

export type ResearchAnalysisInput = z.infer<typeof researchAnalysisInputSchema>;

// ── Artifact Payloads ────────────────────────────────────────────

export const validSourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    url: z.string().optional(),
    author: z.string().optional(),
    publishedAt: z.string().optional(),
    /** `content` when present, `excerpt` otherwise — always non-empty. */
    text: z.string().min(1),
  })
  .strict();

export type ValidSource = z.infer<typeof validSourceSchema>;

export const invalidSourceSchema = z
  .object({
    id: z.string().min(1),
    reasons: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type InvalidSource = z.infer<typeof invalidSourceSchema>;

export const sourceInventorySchema = z
  .object({
    question: z.string().min(1),
    totalSources: z.number().int().nonnegative(),
    validSources: z.array(validSourceSchema),
    invalidSources: z.array(invalidSourceSchema),
  })
  .strict();

export type SourceInventory = z.infer<typeof sourceInventorySchema>;

export const claimSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export type Claim = z.infer<typeof claimSchema>;

export const extractedClaimsSchema = z
  .object({
    question: z.string().min(1),
    claims: z.array(claimSchema),
  })
  .strict();

export type ExtractedClaims = z.infer<typeof extractedClaimsSchema>;

export const agreementSchema = z.enum(["single-source", "agreement", "conflict"]);

export type Agreement = z.infer<typeof agreementSchema>;

export const comparisonGroupSchema = z
  .object({
    id: z.string().min(1),
    representativeText: z.string().min(1),
    claimIds: z.array(z.string().min(1)).min(1),
    sourceIds: z.array(z.string().min(1)).min(1),
    agreement: agreementSchema,
  })
  .strict();

export type ComparisonGroup = z.infer<typeof comparisonGroupSchema>;

export const comparisonMatrixSchema = z
  .object({
    question: z.string().min(1),
    groups: z.array(comparisonGroupSchema),
  })
  .strict();

export type ComparisonMatrix = z.infer<typeof comparisonMatrixSchema>;

export const confidenceSchema = z.enum(["low", "medium", "high"]);

export type Confidence = z.infer<typeof confidenceSchema>;

export const keyFindingSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1),
    confidence: confidenceSchema,
    conflicting: z.boolean(),
  })
  .strict();

export type KeyFinding = z.infer<typeof keyFindingSchema>;

export const findingsSummarySchema = z
  .object({
    question: z.string().min(1),
    keyFindings: z.array(keyFindingSchema),
    sourceCount: z.number().int().nonnegative(),
    claimCount: z.number().int().nonnegative(),
  })
  .strict();

export type FindingsSummary = z.infer<typeof findingsSummarySchema>;

export const citationSchema = z
  .object({
    sourceId: z.string().min(1),
    title: z.string().min(1),
    url: z.string().optional(),
  })
  .strict();

export type Citation = z.infer<typeof citationSchema>;

export const conflictSchema = z
  .object({
    statement: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type Conflict = z.infer<typeof conflictSchema>;

export const researchBriefSchema = z
  .object({
    question: z.string().min(1),
    sourceInventory: z
      .object({
        totalSources: z.number().int().nonnegative(),
        validSourceCount: z.number().int().nonnegative(),
        invalidSourceCount: z.number().int().nonnegative(),
      })
      .strict(),
    /** Every `sourceIds` entry here traces back to a supplied source id. */
    keyFindings: z.array(keyFindingSchema),
    conflicts: z.array(conflictSchema),
    citations: z.array(citationSchema),
  })
  .strict();

export type ResearchBrief = z.infer<typeof researchBriefSchema>;

// ── Artifact Identity ────────────────────────────────────────────

/**
 * Stable logical ids for this workflow's artifacts.
 *
 * Distinct from the content-addressed id `ArtifactStore.save` returns. A
 * content hash changes whenever the bytes change, which makes it useless as a
 * name for "this run's findings summary": incremental planning needs to say
 * "the sources changed", and versioning needs to know that v2 succeeds v1 of
 * *the same* artifact. These ids provide that identity; the hash identifies
 * the payload behind it.
 */
export const ARTIFACT_IDS = {
  sourceInventory: "source-inventory",
  extractedClaims: "extracted-claims",
  comparisonMatrix: "comparison-matrix",
  findingsSummary: "findings-summary",
  researchBrief: "research-brief",
} as const;

export const ARTIFACT_TYPES = {
  sourceInventory: "research.source-inventory",
  extractedClaims: "research.extracted-claims",
  comparisonMatrix: "research.comparison-matrix",
  findingsSummary: "research.findings-summary",
  researchBrief: "research.brief",
} as const;

// ── Capability Output ────────────────────────────────────────────

/** Every capability in this workflow returns exactly one artifact reference. */
export const capabilityOutputSchema = z.object({
  artifactRef: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  }),
});

export type CapabilityOutput = z.infer<typeof capabilityOutputSchema>;
