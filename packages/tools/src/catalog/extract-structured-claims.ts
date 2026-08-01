// packages/tools/src/catalog/extract-structured-claims.ts
import { toolManifestSchema } from "@designflow/sdk";
import type { Tool, ToolManifest } from "@designflow/sdk";
import { z } from "zod";

/**
 * Splits a source's text into sentences and keeps the ones that read as
 * claims: statements using an assertive verb, rather than a question or a
 * bare fragment.
 *
 * A heuristic, not a comprehension of the text — it does not know whether a
 * claim is true, only that it is shaped like one. Every kept sentence is
 * tagged with the source id it came from, so a caller can trace a claim back
 * to where it was read.
 */

const MAX_TEXT_LENGTH = 50_000;

export const extractStructuredClaimsInputSchema = z
  .object({
    sourceId: z.string().min(1),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
  })
  .strict();

export type ExtractStructuredClaimsInput = z.infer<typeof extractStructuredClaimsInputSchema>;

const claimSchema = z
  .object({
    text: z.string(),
    sourceId: z.string(),
  })
  .strict();

export type ExtractedClaim = z.infer<typeof claimSchema>;

export const extractStructuredClaimsOutputSchema = z
  .object({
    sourceId: z.string(),
    claims: z.array(claimSchema),
    claimCount: z.number().int().nonnegative(),
  })
  .strict();

export type ExtractStructuredClaimsOutput = z.infer<typeof extractStructuredClaimsOutputSchema>;

export const extractStructuredClaimsManifest: ToolManifest = toolManifestSchema.parse({
  id: "extract-structured-claims",
  name: "Extract structured claims",
  description: "Splits source text into sentences and keeps the ones shaped like claims",
  version: "0.1.0",
  inputSchema: {
    description: "The source text to extract claims from",
    fields: [
      { name: "sourceId", type: "string", required: true, description: "The source the text came from" },
      { name: "text", type: "string", required: true, description: "The text to scan for claims" },
    ],
  },
  outputSchema: {
    description: "The claim-like sentences found, each tagged with the source id",
    fields: [
      { name: "sourceId", type: "string", required: true },
      { name: "claims", type: "object", required: true },
      { name: "claimCount", type: "number", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

/** Verbs that mark a sentence as asserting something, rather than asking or describing loosely. */
const ASSERTIVE_VERBS = [
  "is",
  "are",
  "was",
  "were",
  "shows",
  "show",
  "demonstrates",
  "demonstrate",
  "found",
  "finds",
  "concludes",
  "conclude",
  "indicates",
  "indicate",
  "proves",
  "prove",
  "confirms",
  "confirm",
  "reports",
  "report",
  "states",
  "state",
  "reveals",
  "reveal",
  "suggests",
  "suggest",
  "causes",
  "cause",
];

const MIN_SENTENCE_LENGTH = 15;

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function isClaimLike(sentence: string): boolean {
  if (sentence.length < MIN_SENTENCE_LENGTH) return false;
  if (sentence.endsWith("?")) return false;

  const normalized = sentence.toLowerCase();
  return ASSERTIVE_VERBS.some((verb) => new RegExp(`\\b${verb}\\b`).test(normalized));
}

function extract(input: ExtractStructuredClaimsInput): ExtractStructuredClaimsOutput {
  const claims = splitIntoSentences(input.text)
    .filter(isClaimLike)
    .map((text) => ({ text, sourceId: input.sourceId }));

  return extractStructuredClaimsOutputSchema.parse({
    sourceId: input.sourceId,
    claims,
    claimCount: claims.length,
  });
}

class ExtractStructuredClaimsTool
  implements Tool<ExtractStructuredClaimsInput, ExtractStructuredClaimsOutput>
{
  public readonly manifest = extractStructuredClaimsManifest;
  public readonly inputSchema = extractStructuredClaimsInputSchema;
  public readonly outputSchema = extractStructuredClaimsOutputSchema;

  public execute(input: ExtractStructuredClaimsInput): Promise<ExtractStructuredClaimsOutput> {
    return Promise.resolve(extract(input));
  }
}

export const extractStructuredClaimsTool: Tool<
  ExtractStructuredClaimsInput,
  ExtractStructuredClaimsOutput
> = new ExtractStructuredClaimsTool();
