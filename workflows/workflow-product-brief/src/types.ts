// workflows/workflow-product-brief/src/types.ts
import { z } from "zod";

/**
 * Domain contracts for the Product Brief workflow.
 *
 * Every artifact payload is validated at both ends: the capability that writes
 * it parses before saving, and the capability that reads it parses after
 * loading. Nodes never hand each other values — the artifact store is the only
 * channel between them, so a schema mismatch surfaces as a validation error
 * rather than a wrong result.
 */

// ── Workflow Input ───────────────────────────────────────────────

export const productBriefInputSchema = z
  .object({
    /** The raw product request. Split into lines; each non-empty line reads as one ask. */
    productRequest: z.string().min(1),
    /** Who the product is for. Read verbatim — never inferred. */
    targetUser: z.string().min(1).default("unspecified user"),
    /** Why the request matters. Read verbatim — never inferred. */
    whyItMatters: z.string().min(1).default("Not specified"),
    /** Constraints supplied alongside the request (e.g. "must ship this quarter"). */
    constraints: z.array(z.string().min(1)).default([]),
    /** Items the requester explicitly wants covered. Drives in-scope when present. */
    desiredOutputScope: z.array(z.string().min(1)).default([]),
    /** Items the requester explicitly wants excluded. */
    excludedScope: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ProductBriefInput = z.infer<typeof productBriefInputSchema>;

// ── Artifact Payloads ────────────────────────────────────────────

export const problemStatementSchema = z
  .object({
    targetUser: z.string().min(1),
    problem: z.string().min(1),
    motivation: z.string().min(1),
    /** Each non-empty line of the original request, trimmed and in order. */
    requestLines: z.array(z.string().min(1)),
  })
  .strict();

export type ProblemStatement = z.infer<typeof problemStatementSchema>;

export const scopeDefinitionSchema = z
  .object({
    inScope: z.array(z.string().min(1)),
    outOfScope: z.array(z.string().min(1)),
  })
  .strict();

export type ScopeDefinition = z.infer<typeof scopeDefinitionSchema>;

export const priorityLevelSchema = z.enum(["high", "medium", "low"]);

export type PriorityLevel = z.infer<typeof priorityLevelSchema>;

export const requirementSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    priority: priorityLevelSchema,
  })
  .strict();

export type Requirement = z.infer<typeof requirementSchema>;

export const requirementsSchema = z
  .object({
    items: z.array(requirementSchema),
  })
  .strict();

export type Requirements = z.infer<typeof requirementsSchema>;

export const acceptanceCriterionSchema = z
  .object({
    id: z.string().min(1),
    /** The requirement this criterion verifies. Every criterion links to a real requirement id. */
    requirementId: z.string().min(1),
    description: z.string().min(1),
    /** Always true for this workflow's phrasing, which states a pass/fail condition. */
    measurable: z.boolean(),
  })
  .strict();

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

export const acceptanceCriteriaSchema = z
  .object({
    items: z.array(acceptanceCriterionSchema),
  })
  .strict();

export type AcceptanceCriteria = z.infer<typeof acceptanceCriteriaSchema>;

export const riskEntryKindSchema = z.enum(["risk", "assumption"]);

export type RiskEntryKind = z.infer<typeof riskEntryKindSchema>;

export const riskEntrySchema = z
  .object({
    id: z.string().min(1),
    kind: riskEntryKindSchema,
    description: z.string().min(1),
    /** The source line that triggered this entry (a requirement or a constraint). */
    source: z.string().min(1),
  })
  .strict();

export type RiskEntry = z.infer<typeof riskEntrySchema>;

export const riskAssumptionRegisterSchema = z
  .object({
    items: z.array(riskEntrySchema),
  })
  .strict();

export type RiskAssumptionRegister = z.infer<typeof riskAssumptionRegisterSchema>;

export const productBriefSchema = z
  .object({
    problemStatement: problemStatementSchema,
    scope: scopeDefinitionSchema,
    requirements: requirementsSchema,
    acceptanceCriteria: acceptanceCriteriaSchema,
    risks: riskAssumptionRegisterSchema,
  })
  .strict();

export type ProductBrief = z.infer<typeof productBriefSchema>;

// ── Artifact Identity ────────────────────────────────────────────

/**
 * Stable logical ids for this workflow's artifacts.
 *
 * Distinct from the content-addressed id `ArtifactStore.save` returns. A
 * content hash changes whenever the bytes change, which makes it useless as a
 * name for "the requirements of this brief": incremental planning needs to say
 * "requirements changed", and versioning needs to know that v2 succeeds v1 of
 * *the same* artifact. These ids provide that identity; the hash identifies
 * the payload behind it.
 */
export const ARTIFACT_IDS = {
  problemStatement: "problem-statement",
  scopeDefinition: "scope-definition",
  requirements: "requirements",
  acceptanceCriteria: "acceptance-criteria",
  riskAssumptionRegister: "risk-assumption-register",
  productBrief: "product-brief",
} as const;

export const ARTIFACT_TYPES = {
  problemStatement: "product.problem-statement",
  scopeDefinition: "product.scope-definition",
  requirements: "product.requirements",
  acceptanceCriteria: "product.acceptance-criteria",
  riskAssumptionRegister: "product.risk-assumption-register",
  productBrief: "product.brief",
} as const;

// ── Capability Output ────────────────────────────────────────────

/** Every capability in this workflow returns exactly one artifact reference. */
export const capabilityOutputSchema = z
  .object({
    artifactRef: z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()),
    }),
  })
  .strict();

export type CapabilityOutput = z.infer<typeof capabilityOutputSchema>;
