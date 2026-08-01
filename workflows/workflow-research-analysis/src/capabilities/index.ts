// workflows/workflow-research-analysis/src/capabilities/index.ts
import { z } from "zod";
import type { Capability, CapabilityContext } from "@designflow/sdk";
import {
  ARTIFACT_IDS,
  ARTIFACT_TYPES,
  capabilityOutputSchema,
  comparisonMatrixSchema,
  extractedClaimsSchema,
  findingsSummarySchema,
  researchAnalysisInputSchema,
  researchBriefSchema,
  sourceInventorySchema,
  type Agreement,
  type Citation,
  type Claim,
  type ComparisonGroup,
  type ComparisonMatrix,
  type Confidence,
  type Conflict,
  type ExtractedClaims,
  type FindingsSummary,
  type InvalidSource,
  type KeyFinding,
  type ResearchBrief,
  type SourceInventory,
  type ValidSource,
  type CapabilityOutput,
} from "../types";
import { readArtifact, writeArtifact } from "../artifact-io";

/**
 * The five capabilities of the Research Analysis workflow.
 *
 * Every one of them is a **pure function of its inputs**. No timestamps, no
 * randomness, no ambient state, and — deliberately — no network access: every
 * source this workflow can ever reason about arrives in the workflow input as
 * a bounded, explicit array. There is no "fetch this URL" step anywhere here,
 * so a run's output can never depend on what the web looked like at the
 * moment it ran.
 *
 * That determinism is not incidental tidiness: artifact versioning compares a
 * re-emitted artifact's metadata against the previous version, so a
 * capability that varied its output run to run would report a change every
 * time and make incremental reuse impossible.
 */

/** Stable, order-independent list. Keeps derived output deterministic. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

// ── 1. Normalize Research Question ───────────────────────────────

export const normalizeResearchQuestionCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "normalize-research-question",
  name: "Normalize research question",
  description:
    "Validates the research question and the supplied source list, flagging sources missing required fields",
  type: "pure",
  inputSchema: researchAnalysisInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(
    context: CapabilityContext,
    input: unknown,
  ): Promise<CapabilityOutput> {
    const parsed = researchAnalysisInputSchema.parse(input);

    const validSources: ValidSource[] = [];
    const invalidSources: InvalidSource[] = [];

    for (const source of parsed.sources) {
      const title = source.title?.trim() ?? "";
      const text = (source.content ?? source.excerpt ?? "").trim();

      const reasons: string[] = [];
      if (title.length === 0) reasons.push("missing title");
      if (text.length === 0) reasons.push("missing content and excerpt");

      if (reasons.length > 0) {
        invalidSources.push({ id: source.id, reasons });
        continue;
      }

      validSources.push({
        id: source.id,
        title,
        text,
        ...(source.url !== undefined ? { url: source.url } : {}),
        ...(source.author !== undefined ? { author: source.author } : {}),
        ...(source.publishedAt !== undefined
          ? { publishedAt: source.publishedAt }
          : {}),
      });
    }

    const inventory: SourceInventory = sourceInventorySchema.parse({
      question: parsed.question,
      totalSources: parsed.sources.length,
      validSources,
      invalidSources,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.sourceInventory,
      artifactType: ARTIFACT_TYPES.sourceInventory,
      name: "Source inventory",
      payload: inventory,
      summary: {
        question: inventory.question,
        totalSources: inventory.totalSources,
        validSourceCount: inventory.validSources.length,
        invalidSourceCount: inventory.invalidSources.length,
      },
    });
  },
};

// ── 2. Extract Claims ─────────────────────────────────────────────

/** Rough sentence/line boundary — no NLP, just deterministic punctuation. */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|\n+/;

/** Below this length a "claim" is too short to be a claim (stray fragment). */
const MIN_CLAIM_LENGTH = 8;

function splitIntoClaims(text: string): string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= MIN_CLAIM_LENGTH);
}

export const extractClaimsCapability: Capability<unknown, CapabilityOutput> = {
  id: "extract-claims",
  name: "Extract claims",
  description:
    "Pulls discrete claim statements out of each valid source's supplied text",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const inventory = await readArtifact(
      context,
      ARTIFACT_IDS.sourceInventory,
      sourceInventorySchema,
    );

    const claims: Claim[] = inventory.validSources.flatMap((source) =>
      splitIntoClaims(source.text).map((text, index) => ({
        id: `${source.id}-c${index + 1}`,
        sourceId: source.id,
        text,
      })),
    );

    const extracted: ExtractedClaims = extractedClaimsSchema.parse({
      question: inventory.question,
      claims,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.extractedClaims,
      artifactType: ARTIFACT_TYPES.extractedClaims,
      name: "Extracted claims",
      payload: extracted,
      summary: {
        claimCount: extracted.claims.length,
        sourceIds: sortedUnique(extracted.claims.map((claim) => claim.sourceId)),
      },
    });
  },
};

// ── 3. Compare Findings ───────────────────────────────────────────

/** Small, fixed stopword list — enough to keep overlap scoring meaningful. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "in", "is", "it", "its", "of", "on", "or", "that", "the",
  "this", "to", "was", "were", "will", "with",
]);

/** Words a claim uses to negate a statement — the conflict signal. */
const NEGATIONS = new Set([
  "not", "no", "never", "cannot", "isn't", "doesn't", "won't", "don't",
  "wasn't", "aren't", "didn't",
]);

/** Overlap threshold above which two claims are treated as the same aspect. */
const OVERLAP_THRESHOLD = 0.34;

function keywordsOf(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word));

  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function hasNegation(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/);
  return words.some((word) => NEGATIONS.has(word.replace(/[^a-z']/g, "")));
}

interface Bucket {
  readonly keywords: Set<string>;
  readonly claims: Claim[];
}

/** Greedy, order-preserving clustering by keyword overlap. Deterministic. */
function clusterClaims(claims: readonly Claim[]): Bucket[] {
  const buckets: Bucket[] = [];

  for (const claim of claims) {
    const keywords = keywordsOf(claim.text);

    const match = buckets.find(
      (bucket) => jaccard(bucket.keywords, keywords) >= OVERLAP_THRESHOLD,
    );

    if (match !== undefined) {
      match.claims.push(claim);
      for (const word of keywords) match.keywords.add(word);
      continue;
    }

    buckets.push({ keywords, claims: [claim] });
  }

  return buckets;
}

function agreementOf(bucket: Bucket): Agreement {
  const sourceIds = sortedUnique(bucket.claims.map((claim) => claim.sourceId));
  if (sourceIds.length <= 1) return "single-source";

  const negated = bucket.claims.some((claim) => hasNegation(claim.text));
  const affirmed = bucket.claims.some((claim) => !hasNegation(claim.text));

  return negated && affirmed ? "conflict" : "agreement";
}

export const compareFindingsCapability: Capability<unknown, CapabilityOutput> = {
  id: "compare-findings",
  name: "Compare findings",
  description:
    "Groups claims addressing the same aspect of the question and flags agreement or conflict between sources",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const extracted = await readArtifact(
      context,
      ARTIFACT_IDS.extractedClaims,
      extractedClaimsSchema,
    );

    const buckets = clusterClaims(extracted.claims);

    const groups: ComparisonGroup[] = buckets.map((bucket, index) => ({
      id: `group-${index + 1}`,
      representativeText: bucket.claims[0]?.text ?? "",
      claimIds: bucket.claims.map((claim) => claim.id),
      sourceIds: sortedUnique(bucket.claims.map((claim) => claim.sourceId)),
      agreement: agreementOf(bucket),
    }));

    const matrix: ComparisonMatrix = comparisonMatrixSchema.parse({
      question: extracted.question,
      groups,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.comparisonMatrix,
      artifactType: ARTIFACT_TYPES.comparisonMatrix,
      name: "Comparison matrix",
      payload: matrix,
      summary: {
        groupCount: matrix.groups.length,
        conflictCount: matrix.groups.filter(
          (group) => group.agreement === "conflict",
        ).length,
      },
    });
  },
};

// ── 4. Summarize Findings ─────────────────────────────────────────

function confidenceOf(group: ComparisonGroup): Confidence {
  if (group.agreement === "conflict") return "low";
  if (group.agreement === "single-source") return "low";
  return group.sourceIds.length >= 3 ? "high" : "medium";
}

export const summarizeFindingsCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "summarize-findings",
  name: "Summarize findings",
  description:
    "Builds a structured summary of what the sources collectively say, each finding citing its source ids",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const matrix = await readArtifact(
      context,
      ARTIFACT_IDS.comparisonMatrix,
      comparisonMatrixSchema,
    );
    const inventory = await readArtifact(
      context,
      ARTIFACT_IDS.sourceInventory,
      sourceInventorySchema,
    );
    const extracted = await readArtifact(
      context,
      ARTIFACT_IDS.extractedClaims,
      extractedClaimsSchema,
    );

    const keyFindings: KeyFinding[] = matrix.groups.map((group, index) => ({
      id: `finding-${index + 1}`,
      statement: group.representativeText,
      sourceIds: group.sourceIds,
      confidence: confidenceOf(group),
      conflicting: group.agreement === "conflict",
    }));

    const summary: FindingsSummary = findingsSummarySchema.parse({
      question: matrix.question,
      keyFindings,
      sourceCount: inventory.validSources.length,
      claimCount: extracted.claims.length,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.findingsSummary,
      artifactType: ARTIFACT_TYPES.findingsSummary,
      name: "Findings summary",
      payload: summary,
      summary: {
        findingCount: summary.keyFindings.length,
        conflictCount: summary.keyFindings.filter(
          (finding) => finding.conflicting,
        ).length,
      },
    });
  },
};

// ── 5. Produce Research Brief ─────────────────────────────────────

export const produceResearchBriefCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "produce-research-brief",
  name: "Produce research brief",
  description:
    "Combines the question, source inventory and key findings into the final typed brief — every claim cites a supplied source id",
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const summary = await readArtifact(
      context,
      ARTIFACT_IDS.findingsSummary,
      findingsSummarySchema,
    );
    const inventory = await readArtifact(
      context,
      ARTIFACT_IDS.sourceInventory,
      sourceInventorySchema,
    );
    const matrix = await readArtifact(
      context,
      ARTIFACT_IDS.comparisonMatrix,
      comparisonMatrixSchema,
    );

    const sourceById = new Map(
      inventory.validSources.map((source) => [source.id, source] as const),
    );

    const citedSourceIds = sortedUnique(
      summary.keyFindings.flatMap((finding) => finding.sourceIds),
    );

    // Every citation traces back to a source the caller actually supplied —
    // never a fabricated or fetched one.
    const citations: Citation[] = citedSourceIds
      .map((sourceId) => sourceById.get(sourceId))
      .filter((source): source is ValidSource => source !== undefined)
      .map((source) => ({
        sourceId: source.id,
        title: source.title,
        ...(source.url !== undefined ? { url: source.url } : {}),
      }));

    const conflicts: Conflict[] = matrix.groups
      .filter((group) => group.agreement === "conflict")
      .map((group) => ({
        statement: group.representativeText,
        sourceIds: group.sourceIds,
      }));

    const brief: ResearchBrief = researchBriefSchema.parse({
      question: summary.question,
      sourceInventory: {
        totalSources: inventory.totalSources,
        validSourceCount: inventory.validSources.length,
        invalidSourceCount: inventory.invalidSources.length,
      },
      keyFindings: summary.keyFindings,
      conflicts,
      citations,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.researchBrief,
      artifactType: ARTIFACT_TYPES.researchBrief,
      name: "Research brief",
      payload: brief,
      summary: {
        findingCount: brief.keyFindings.length,
        citationCount: brief.citations.length,
        conflictCount: brief.conflicts.length,
      },
    });
  },
};

// ── Registry ─────────────────────────────────────────────────────

export const researchAnalysisCapabilities: readonly Capability<
  unknown,
  CapabilityOutput
>[] = [
  normalizeResearchQuestionCapability,
  extractClaimsCapability,
  compareFindingsCapability,
  summarizeFindingsCapability,
  produceResearchBriefCapability,
];
