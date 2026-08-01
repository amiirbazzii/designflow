// packages/tools/src/catalog/classify-product-request.ts
import {
  toolManifestSchema,
  type Tool,
  type ToolManifest,
} from "@designflow/sdk";

import { z } from "zod";

/**
 * Reads a product ask and says what kind of ask it is.
 *
 * Same ordered-keyword-rule shape as `classify-design-task`: no model, no
 * side effects, every answer traceable to the words that produced it.
 */

export const classifyProductRequestInputSchema = z
  .object({
    request: z.string().min(1).max(5_000),
  })
  .strict();

export type ClassifyProductRequestInput = z.infer<typeof classifyProductRequestInputSchema>;

export const productRequestTypeSchema = z.enum([
  "new_feature",
  "improvement",
  "research",
  "unknown",
]);

export type ProductRequestType = z.infer<typeof productRequestTypeSchema>;

export const classifyProductRequestOutputSchema = z
  .object({
    requestType: productRequestTypeSchema,
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string()).default([]),
  })
  .strict();

export type ClassifyProductRequestOutput = z.infer<typeof classifyProductRequestOutputSchema>;

export const classifyProductRequestManifest: ToolManifest = toolManifestSchema.parse({
  id: "classify-product-request",
  name: "Classify product request",
  description: "Decides what kind of product ask a request describes",
  version: "0.1.0",
  inputSchema: {
    description: "The request to classify",
    fields: [
      { name: "request", type: "string", required: true, description: "What was asked for" },
    ],
  },
  outputSchema: {
    description: "The kind of ask, with a confidence and the words behind it",
    fields: [
      { name: "requestType", type: "string", required: true },
      { name: "confidence", type: "number", required: true },
      { name: "signals", type: "string[]", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

/**
 * Ordered most specific first. "new_feature" beats "improvement" because a
 * request that names both ("build a new export flow to improve retention")
 * is asking for the new thing; the improvement is the reason, not the ask.
 */
const RULES: readonly {
  readonly requestType: ProductRequestType;
  readonly terms: readonly string[];
}[] = [
  {
    requestType: "new_feature",
    terms: ["new feature", "add support", "build a", "introduce", "launch", "create a new", "add a"],
  },
  {
    requestType: "improvement",
    terms: ["improve", "enhance", "optimize", "optimise", "speed up", "polish", "refine", "fix", "streamline"],
  },
  {
    requestType: "research",
    terms: ["research", "investigate", "explore options", "feasibility", "compare", "evaluate"],
  },
];

function matches(haystack: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);
}

function classify(request: string): ClassifyProductRequestOutput {
  const normalized = request.toLowerCase();

  for (const rule of RULES) {
    const signals = rule.terms.filter((term) => matches(normalized, term));

    if (signals.length > 0) {
      return classifyProductRequestOutputSchema.parse({
        requestType: rule.requestType,
        confidence: Math.min(1, 0.5 + signals.length * 0.2),
        signals,
      });
    }
  }

  return classifyProductRequestOutputSchema.parse({
    requestType: "unknown",
    confidence: 0,
    signals: [],
  });
}

class ClassifyProductRequestTool
  implements Tool<ClassifyProductRequestInput, ClassifyProductRequestOutput>
{
  public readonly manifest = classifyProductRequestManifest;
  public readonly inputSchema = classifyProductRequestInputSchema;
  public readonly outputSchema = classifyProductRequestOutputSchema;

  public execute(input: ClassifyProductRequestInput): Promise<ClassifyProductRequestOutput> {
    return Promise.resolve(classify(input.request));
  }
}

export const classifyProductRequestTool: Tool<
  ClassifyProductRequestInput,
  ClassifyProductRequestOutput
> = new ClassifyProductRequestTool();
