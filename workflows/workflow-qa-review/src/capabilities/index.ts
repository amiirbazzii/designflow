// workflows/workflow-qa-review/src/capabilities/index.ts
import { z } from "zod";
import type { Capability, CapabilityContext } from "@designflow/sdk";
import {
  ARTIFACT_IDS,
  ARTIFACT_TYPES,
  SEVERITY_RANK,
  accessibilityReviewSchema,
  capabilityOutputSchema,
  issueListSchema,
  qaReportSchema,
  qaReviewInputSchema,
  reviewTargetSummarySchema,
  severityAssessmentSchema,
  type AccessibilityCounts,
  type AccessibilityFinding,
  type AccessibilityReview,
  type AssessedIssue,
  type Issue,
  type IssueKind,
  type IssueList,
  type QaReport,
  type ReviewItem,
  type ReviewTargetSummary,
  type Severity,
  type SeverityAssessment,
  type SeverityCounts,
  type CapabilityOutput,
} from "../types";
import { readArtifact, writeArtifact } from "../artifact-io";

/**
 * The five capabilities of the QA Review workflow.
 *
 * Every one of them is a **pure function of its inputs**. No timestamps, no
 * randomness, no ambient state. That is not incidental tidiness: artifact
 * versioning compares a re-emitted artifact's metadata against the previous
 * version, so a capability that varied its output run to run would report a
 * change every time and make incremental reuse impossible.
 *
 * They are also `type: "pure"` except `produce-qa-report`, which is the
 * step that publishes a verdict and is therefore the natural approval gate.
 */

/** Stable, order-independent list. Keeps derived output deterministic. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

const ZERO_SEVERITY_COUNTS: SeverityCounts = {
  blocker: 0,
  major: 0,
  minor: 0,
  info: 0,
};

const ZERO_ACCESSIBILITY_COUNTS: AccessibilityCounts = {
  aria: 0,
  contrast: 0,
  keyboard: 0,
  semantics: 0,
};

// ── 1. Collect Review Target ─────────────────────────────────────

export const collectReviewTargetCapability: Capability<unknown, CapabilityOutput> = {
  id: "collect-review-target",
  name: "Collect review target",
  description: "Normalizes the supplied implementation items into a review target summary",
  type: "pure",
  inputSchema: qaReviewInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(
    context: CapabilityContext,
    input: unknown,
  ): Promise<CapabilityOutput> {
    const parsed = qaReviewInputSchema.parse(input);

    const missingContentPaths = parsed.items
      .filter((item) => (item.content ?? "").trim().length === 0)
      .map((item) => item.path);

    const summary: ReviewTargetSummary = reviewTargetSummarySchema.parse({
      id: parsed.id,
      description: parsed.description,
      scope: parsed.scope,
      severityThreshold: parsed.severityThreshold,
      items: parsed.items,
      itemCount: parsed.items.length,
      kinds: sortedUnique(parsed.items.map((item) => item.kind)),
      missingContentPaths,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.reviewTargetSummary,
      artifactType: ARTIFACT_TYPES.reviewTargetSummary,
      name: "Review target summary",
      payload: summary,
      summary: {
        itemCount: summary.itemCount,
        kinds: summary.kinds,
        missingContentCount: summary.missingContentPaths.length,
      },
    });
  },
};

// ── 2. Evaluate Correctness ──────────────────────────────────────

export const evaluateCorrectnessCapability: Capability<unknown, CapabilityOutput> = {
  id: "evaluate-correctness",
  name: "Evaluate correctness",
  description: "Flags missing content, duplicate paths, and mislabeled items",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const target = await readArtifact(
      context,
      ARTIFACT_IDS.reviewTargetSummary,
      reviewTargetSummarySchema,
    );

    const issues: Issue[] = [
      ...missingContentIssues(target.items),
      ...duplicatePathIssues(target.items),
      ...mislabeledTestIssues(target.items),
    ];

    const issueList: IssueList = issueListSchema.parse({
      targetId: target.id,
      issues,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.issueList,
      artifactType: ARTIFACT_TYPES.issueList,
      name: "Issue list",
      payload: issueList,
      summary: {
        issueCount: issueList.issues.length,
        kinds: sortedUnique(issueList.issues.map((issue) => issue.kind)),
      },
    });
  },
};

// ── 3. Assess Severity ───────────────────────────────────────────

const SEVERITY_BY_ISSUE_KIND: Record<IssueKind, Severity> = {
  completeness: "blocker",
  consistency: "major",
  correctness: "minor",
};

export const assessSeverityCapability: Capability<unknown, CapabilityOutput> = {
  id: "assess-severity",
  name: "Assess severity",
  description: "Tags every issue with a severity and flags those at or above the threshold",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const target = await readArtifact(
      context,
      ARTIFACT_IDS.reviewTargetSummary,
      reviewTargetSummarySchema,
    );
    const issueList = await readArtifact(
      context,
      ARTIFACT_IDS.issueList,
      issueListSchema,
    );

    const threshold = target.severityThreshold;
    const thresholdRank = SEVERITY_RANK[threshold];

    const issues: AssessedIssue[] = issueList.issues.map((issue) => ({
      ...issue,
      severity: SEVERITY_BY_ISSUE_KIND[issue.kind],
    }));

    const counts: SeverityCounts = { ...ZERO_SEVERITY_COUNTS };
    for (const issue of issues) {
      counts[issue.severity] += 1;
    }

    const flaggedIssueIds = issues
      .filter((issue) => SEVERITY_RANK[issue.severity] >= thresholdRank)
      .map((issue) => issue.id);

    const assessment: SeverityAssessment = severityAssessmentSchema.parse({
      targetId: target.id,
      threshold,
      issues,
      counts,
      flaggedIssueIds,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.severityAssessment,
      artifactType: ARTIFACT_TYPES.severityAssessment,
      name: "Severity assessment",
      payload: assessment,
      summary: {
        threshold: assessment.threshold,
        flaggedCount: assessment.flaggedIssueIds.length,
        counts: assessment.counts,
      },
    });
  },
};

// ── 4. Evaluate Accessibility ────────────────────────────────────

export const evaluateAccessibilityCapability: Capability<unknown, CapabilityOutput> = {
  id: "evaluate-accessibility",
  name: "Evaluate accessibility",
  description: "Checks reviewed items for common ARIA, contrast, keyboard, and semantics gaps",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const target = await readArtifact(
      context,
      ARTIFACT_IDS.reviewTargetSummary,
      reviewTargetSummarySchema,
    );

    const findings = target.items.flatMap((item) => accessibilityFindingsFor(item));

    const counts: AccessibilityCounts = { ...ZERO_ACCESSIBILITY_COUNTS };
    for (const finding of findings) {
      counts[finding.category] += 1;
    }

    const review: AccessibilityReview = accessibilityReviewSchema.parse({
      targetId: target.id,
      findings,
      counts,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.accessibilityReview,
      artifactType: ARTIFACT_TYPES.accessibilityReview,
      name: "Accessibility review",
      payload: review,
      summary: {
        findingCount: review.findings.length,
        counts: review.counts,
      },
    });
  },
};

// ── 5. Produce QA Report ─────────────────────────────────────────

export const produceQaReportCapability: Capability<unknown, CapabilityOutput> = {
  id: "produce-qa-report",
  name: "Produce QA report",
  description: "Publishes the final pass/fail verdict with every issue and accessibility finding",
  // The step that publishes a verdict people act on. Policies gate on this id.
  type: "human_gate",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const assessment = await readArtifact(
      context,
      ARTIFACT_IDS.severityAssessment,
      severityAssessmentSchema,
    );
    const accessibility = await readArtifact(
      context,
      ARTIFACT_IDS.accessibilityReview,
      accessibilityReviewSchema,
    );

    const report: QaReport = qaReportSchema.parse({
      targetId: assessment.targetId,
      verdict: assessment.flaggedIssueIds.length === 0 ? "pass" : "fail",
      threshold: assessment.threshold,
      issueCount: assessment.issues.length,
      flaggedIssueCount: assessment.flaggedIssueIds.length,
      accessibilityFindingCount: accessibility.findings.length,
      issues: assessment.issues,
      accessibilityFindings: accessibility.findings,
      severityCounts: assessment.counts,
      accessibilityCounts: accessibility.counts,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.qaReport,
      artifactType: ARTIFACT_TYPES.qaReport,
      name: "QA report",
      payload: report,
      summary: {
        verdict: report.verdict,
        issueCount: report.issueCount,
        flaggedIssueCount: report.flaggedIssueCount,
        accessibilityFindingCount: report.accessibilityFindingCount,
      },
    });
  },
};

// ── Registry ─────────────────────────────────────────────────────

export const qaReviewCapabilities: readonly Capability<unknown, CapabilityOutput>[] = [
  collectReviewTargetCapability,
  evaluateCorrectnessCapability,
  assessSeverityCapability,
  evaluateAccessibilityCapability,
  produceQaReportCapability,
];

// ── Helpers ──────────────────────────────────────────────────────

function missingContentIssues(items: readonly ReviewItem[]): Issue[] {
  return items
    .filter((item) => (item.content ?? "").trim().length === 0)
    .map((item) => ({
      id: `completeness:${item.path}`,
      description: `Item "${item.path}" is missing implementation content`,
      kind: "completeness" as const,
      location: item.path,
    }));
}

function duplicatePathIssues(items: readonly ReviewItem[]): Issue[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    if (seen.has(item.path)) {
      duplicates.add(item.path);
    } else {
      seen.add(item.path);
    }
  }

  // `items` order, filtered to first occurrence of each duplicated path.
  const reported = new Set<string>();
  const issues: Issue[] = [];
  for (const item of items) {
    if (!duplicates.has(item.path) || reported.has(item.path)) continue;
    reported.add(item.path);
    issues.push({
      id: `consistency:${item.path}`,
      description: `Path "${item.path}" is listed more than once`,
      kind: "consistency",
      location: item.path,
    });
  }

  return issues;
}

/** Paths that read as test files. Case-insensitive, no filesystem access. */
function looksLikeTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.includes("test") || lower.includes("spec");
}

function mislabeledTestIssues(items: readonly ReviewItem[]): Issue[] {
  return items
    .filter((item) => item.kind.toLowerCase() === "test" && !looksLikeTestPath(item.path))
    .map((item) => ({
      id: `correctness:${item.path}`,
      description: `Item "${item.path}" is marked as kind "test" but its path does not look like a test file`,
      kind: "correctness" as const,
      location: item.path,
    }));
}

const INTERACTIVE_PATTERN = /onClick/;
const ARIA_PATTERN = /aria-/;
const RAW_COLOR_PATTERN = /#[0-9a-fA-F]{3,6}/;
const KEYBOARD_HANDLER_PATTERN = /onKeyDown|tabIndex/;
const NON_SEMANTIC_TAG_PATTERN = /<div/;
const SEMANTIC_BUTTON_PATTERN = /<button/;

function accessibilityFindingsFor(item: ReviewItem): AccessibilityFinding[] {
  const content = item.content;
  if (content === undefined) return [];

  const findings: AccessibilityFinding[] = [];
  const isInteractive = INTERACTIVE_PATTERN.test(content);

  if (isInteractive && !ARIA_PATTERN.test(content)) {
    findings.push({
      id: `aria:${item.path}`,
      description: `Interactive markup in "${item.path}" lacks an aria- attribute`,
      category: "aria",
      location: item.path,
    });
  }

  if (RAW_COLOR_PATTERN.test(content)) {
    findings.push({
      id: `contrast:${item.path}`,
      description: `"${item.path}" uses a raw color value; verify contrast ratio`,
      category: "contrast",
      location: item.path,
    });
  }

  if (isInteractive && !KEYBOARD_HANDLER_PATTERN.test(content)) {
    findings.push({
      id: `keyboard:${item.path}`,
      description: `Interactive element in "${item.path}" lacks keyboard support`,
      category: "keyboard",
      location: item.path,
    });
  }

  if (
    isInteractive &&
    NON_SEMANTIC_TAG_PATTERN.test(content) &&
    !SEMANTIC_BUTTON_PATTERN.test(content)
  ) {
    findings.push({
      id: `semantics:${item.path}`,
      description: `Interactive element in "${item.path}" uses a non-semantic tag`,
      category: "semantics",
      location: item.path,
    });
  }

  return findings;
}
