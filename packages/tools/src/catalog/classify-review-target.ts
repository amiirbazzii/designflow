// packages/tools/src/catalog/classify-review-target.ts
import {
  toolManifestSchema,
  type Tool,
  type ToolManifest,
} from "@designflow/sdk";

import { z } from "zod";

/**
 * Reads a review request and says what scope of review it describes.
 *
 * Same shape as `classify-design-task`: ordered keyword rules, no model, no
 * side effects. A person can read every rule and predict the answer, which is
 * what lets a QA agent treat the result as load-bearing rather than advisory.
 *
 * `itemCount`, when supplied, is a second, purely numeric signal — a review
 * request naming dozens of changed files reads as a full-app review even when
 * its wording does not say so explicitly.
 */

export const classifyReviewTargetInputSchema = z
  .object({
    request: z.string().min(1).max(5_000),
    /** How many implementation items the review covers, if known. */
    itemCount: z.number().int().nonnegative().max(100_000).optional(),
  })
  .strict();

export type ClassifyReviewTargetInput = z.infer<typeof classifyReviewTargetInputSchema>;

export const reviewTargetTypeSchema = z.enum(["component", "page", "full_app", "unknown"]);

export type ReviewTargetType = z.infer<typeof reviewTargetTypeSchema>;

export const classifyReviewTargetOutputSchema = z
  .object({
    reviewType: reviewTargetTypeSchema,
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string()).default([]),
  })
  .strict();

export type ClassifyReviewTargetOutput = z.infer<typeof classifyReviewTargetOutputSchema>;

export const classifyReviewTargetManifest: ToolManifest = toolManifestSchema.parse({
  id: "classify-review-target",
  name: "Classify review target",
  description: "Decides what scope of review a request describes",
  version: "0.1.0",
  inputSchema: {
    description: "The review request to classify",
    fields: [
      { name: "request", type: "string", required: true, description: "What was asked to be reviewed" },
      {
        name: "itemCount",
        type: "number",
        required: false,
        description: "How many implementation items the review covers, if known",
      },
    ],
  },
  outputSchema: {
    description: "The scope of review, with a confidence and the words behind it",
    fields: [
      { name: "reviewType", type: "string", required: true },
      { name: "confidence", type: "number", required: true },
      { name: "signals", type: "string[]", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

/** A review request naming this many items reads as a full-app review on its own. */
const LARGE_ITEM_COUNT_THRESHOLD = 20;

/** Ordered most specific first, same reasoning as `classify-design-task`. */
const RULES: readonly {
  readonly reviewType: ReviewTargetType;
  readonly terms: readonly string[];
}[] = [
  {
    reviewType: "full_app",
    terms: ["entire app", "whole app", "full app", "entire application", "whole platform", "everything", "the whole product"],
  },
  {
    reviewType: "page",
    terms: ["page", "screen", "flow", "checkout", "onboarding", "dashboard", "journey"],
  },
  {
    reviewType: "component",
    terms: ["component", "button", "card", "modal", "form", "input", "nav", "dropdown", "tooltip"],
  },
];

function matches(haystack: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);
}

function classify(input: ClassifyReviewTargetInput): ClassifyReviewTargetOutput {
  const normalized = input.request.toLowerCase();
  const largeItemCount = input.itemCount !== undefined && input.itemCount >= LARGE_ITEM_COUNT_THRESHOLD;

  for (const rule of RULES) {
    const signals = rule.terms.filter((term) => matches(normalized, term));

    if (rule.reviewType === "full_app" && largeItemCount) {
      signals.push("large_item_count");
    }

    if (signals.length > 0) {
      return classifyReviewTargetOutputSchema.parse({
        reviewType: rule.reviewType,
        confidence: Math.min(1, 0.5 + signals.length * 0.2),
        signals,
      });
    }
  }

  if (largeItemCount) {
    return classifyReviewTargetOutputSchema.parse({
      reviewType: "full_app",
      confidence: 0.5,
      signals: ["large_item_count"],
    });
  }

  return classifyReviewTargetOutputSchema.parse({
    reviewType: "unknown",
    confidence: 0,
    signals: [],
  });
}

class ClassifyReviewTargetTool
  implements Tool<ClassifyReviewTargetInput, ClassifyReviewTargetOutput>
{
  public readonly manifest = classifyReviewTargetManifest;
  public readonly inputSchema = classifyReviewTargetInputSchema;
  public readonly outputSchema = classifyReviewTargetOutputSchema;

  public execute(input: ClassifyReviewTargetInput): Promise<ClassifyReviewTargetOutput> {
    return Promise.resolve(classify(input));
  }
}

export const classifyReviewTargetTool: Tool<
  ClassifyReviewTargetInput,
  ClassifyReviewTargetOutput
> = new ClassifyReviewTargetTool();
