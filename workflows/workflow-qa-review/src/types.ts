// workflows/workflow-qa-review/src/types.ts
import { z } from "zod";

/**
 * Domain contracts for the QA Review workflow.
 *
 * Every artifact payload is validated at both ends: the capability that writes
 * it parses before saving, and the capability that reads it parses after
 * loading. Nodes never hand each other values — the artifact store is the only
 * channel between them, so a schema mismatch surfaces as a validation error
 * rather than a wrong result.
 *
 * The review target is never read from disk. It arrives as structured data on
 * the workflow input — a list of implementation items the caller has already
 * gathered — so the whole pipeline stays a pure function of its input.
 */

// ── Workflow Input ───────────────────────────────────────────────

export const severitySchema = z.enum(["blocker", "major", "minor", "info"]);

export type Severity = z.infer<typeof severitySchema>;

/** Ranks severities so "at or above the threshold" is a numeric comparison. */
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  minor: 1,
  major: 2,
  blocker: 3,
};

export const reviewItemSchema = z
  .object({
    path: z.string().min(1),
    kind: z.string().min(1),
    content: z.string().optional(),
  })
  .strict();

export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const qaReviewInputSchema = z
  .object({
    /** Identifier of the implementation under review. */
    id: z.string().min(1),
    description: z.string().min(1),
    /**
     * The implementation being reviewed, already supplied by the caller.
     *
     * Stands in for reading a repository. Everything downstream is derived
     * from this list, which is what makes a re-run with an unchanged target
     * reuse cleanly.
     */
    items: z.array(reviewItemSchema).default([]),
    /** Named areas the review should focus on. Informational only. */
    scope: z.array(z.string().min(1)).default([]),
    severityThreshold: severitySchema.default("minor"),
  })
  .strict();

export type QaReviewInput = z.infer<typeof qaReviewInputSchema>;

// ── Artifact Payloads ────────────────────────────────────────────

export const reviewTargetSummarySchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    scope: z.array(z.string().min(1)),
    severityThreshold: severitySchema,
    items: z.array(reviewItemSchema),
    itemCount: z.number().int().nonnegative(),
    kinds: z.array(z.string().min(1)),
    missingContentPaths: z.array(z.string().min(1)),
  })
  .strict();

export type ReviewTargetSummary = z.infer<typeof reviewTargetSummarySchema>;

export const issueKindSchema = z.enum(["completeness", "consistency", "correctness"]);

export type IssueKind = z.infer<typeof issueKindSchema>;

export const issueSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    kind: issueKindSchema,
    location: z.string().min(1).optional(),
  })
  .strict();

export type Issue = z.infer<typeof issueSchema>;

export const issueListSchema = z
  .object({
    targetId: z.string().min(1),
    issues: z.array(issueSchema),
  })
  .strict();

export type IssueList = z.infer<typeof issueListSchema>;

export const assessedIssueSchema = issueSchema.extend({ severity: severitySchema });

export type AssessedIssue = z.infer<typeof assessedIssueSchema>;

export const severityCountsSchema = z
  .object({
    blocker: z.number().int().nonnegative(),
    major: z.number().int().nonnegative(),
    minor: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
  })
  .strict();

export type SeverityCounts = z.infer<typeof severityCountsSchema>;

export const severityAssessmentSchema = z
  .object({
    targetId: z.string().min(1),
    threshold: severitySchema,
    issues: z.array(assessedIssueSchema),
    counts: severityCountsSchema,
    /** Ids of issues whose severity is at or above the threshold. */
    flaggedIssueIds: z.array(z.string().min(1)),
  })
  .strict();

export type SeverityAssessment = z.infer<typeof severityAssessmentSchema>;

export const accessibilityCategorySchema = z.enum([
  "aria",
  "contrast",
  "keyboard",
  "semantics",
]);

export type AccessibilityCategory = z.infer<typeof accessibilityCategorySchema>;

export const accessibilityFindingSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    category: accessibilityCategorySchema,
    location: z.string().min(1).optional(),
  })
  .strict();

export type AccessibilityFinding = z.infer<typeof accessibilityFindingSchema>;

export const accessibilityCountsSchema = z
  .object({
    aria: z.number().int().nonnegative(),
    contrast: z.number().int().nonnegative(),
    keyboard: z.number().int().nonnegative(),
    semantics: z.number().int().nonnegative(),
  })
  .strict();

export type AccessibilityCounts = z.infer<typeof accessibilityCountsSchema>;

export const accessibilityReviewSchema = z
  .object({
    targetId: z.string().min(1),
    findings: z.array(accessibilityFindingSchema),
    counts: accessibilityCountsSchema,
  })
  .strict();

export type AccessibilityReview = z.infer<typeof accessibilityReviewSchema>;

export const qaVerdictSchema = z.enum(["pass", "fail"]);

export type QaVerdict = z.infer<typeof qaVerdictSchema>;

export const qaReportSchema = z
  .object({
    targetId: z.string().min(1),
    verdict: qaVerdictSchema,
    threshold: severitySchema,
    issueCount: z.number().int().nonnegative(),
    flaggedIssueCount: z.number().int().nonnegative(),
    accessibilityFindingCount: z.number().int().nonnegative(),
    issues: z.array(assessedIssueSchema),
    accessibilityFindings: z.array(accessibilityFindingSchema),
    severityCounts: severityCountsSchema,
    accessibilityCounts: accessibilityCountsSchema,
  })
  .strict();

export type QaReport = z.infer<typeof qaReportSchema>;

// ── Artifact Identity ────────────────────────────────────────────

/**
 * Stable logical ids for this workflow's artifacts.
 *
 * Distinct from the content-addressed id `ArtifactStore.save` returns. A
 * content hash changes whenever the bytes change, which makes it useless as a
 * name for "the issue list of this review": incremental planning needs to say
 * "the target changed", and versioning needs to know that v2 succeeds v1 of
 * *the same* artifact. These ids provide that identity; the hash identifies
 * the payload behind it.
 */
export const ARTIFACT_IDS = {
  reviewTargetSummary: "review-target-summary",
  issueList: "issue-list",
  severityAssessment: "severity-assessment",
  accessibilityReview: "accessibility-review",
  qaReport: "qa-report",
} as const;

export const ARTIFACT_TYPES = {
  reviewTargetSummary: "qa.review-target-summary",
  issueList: "qa.issue-list",
  severityAssessment: "qa.severity-assessment",
  accessibilityReview: "qa.accessibility-review",
  qaReport: "qa.report",
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
