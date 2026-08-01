// packages/tools/src/catalog/classify-research-request.ts
import { toolManifestSchema } from "@designflow/sdk";
import type { Tool, ToolManifest } from "@designflow/sdk";
import { z } from "zod";

/**
 * Reads a research request and says how deep it is asking to go.
 *
 * Same ordered-keyword-rule shape as `classify-design-task`: no model, no
 * side effects, every answer traceable to the words that produced it.
 */

export const classifyResearchRequestInputSchema = z
  .object({
    request: z.string().min(1).max(5_000),
  })
  .strict();

export type ClassifyResearchRequestInput = z.infer<typeof classifyResearchRequestInputSchema>;

export const researchDepthSchema = z.enum(["quick", "standard", "deep", "unknown"]);

export type ResearchDepth = z.infer<typeof researchDepthSchema>;

export const classifyResearchRequestOutputSchema = z
  .object({
    depth: researchDepthSchema,
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string()).default([]),
  })
  .strict();

export type ClassifyResearchRequestOutput = z.infer<typeof classifyResearchRequestOutputSchema>;

export const classifyResearchRequestManifest: ToolManifest = toolManifestSchema.parse({
  id: "classify-research-request",
  name: "Classify research request",
  description: "Decides how deep a research request is asking to go",
  version: "0.1.0",
  inputSchema: {
    description: "The research request to classify",
    fields: [
      { name: "request", type: "string", required: true, description: "What was asked for" },
    ],
  },
  outputSchema: {
    description: "The research depth, with a confidence and the words behind it",
    fields: [
      { name: "depth", type: "string", required: true },
      { name: "confidence", type: "number", required: true },
      { name: "signals", type: "string[]", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

/**
 * Ordered most specific first. "deep" beats "standard" because a request
 * naming both a broad ask and a depth qualifier ("a thorough comparison")
 * wants the qualifier honored.
 */
const RULES: readonly {
  readonly depth: ResearchDepth;
  readonly terms: readonly string[];
}[] = [
  {
    depth: "deep",
    terms: [
      "deep dive",
      "comprehensive",
      "exhaustive",
      "in-depth",
      "in depth",
      "thorough",
      "literature review",
      "systematic review",
    ],
  },
  {
    depth: "quick",
    terms: ["quick", "brief", "short summary", "tl;dr", "tldr", "fast answer", "at a glance", "one-liner"],
  },
  {
    depth: "standard",
    terms: ["research", "investigate", "analyze", "analyse", "compare", "overview", "report", "explore"],
  },
];

function matches(haystack: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);
}

function classify(request: string): ClassifyResearchRequestOutput {
  const normalized = request.toLowerCase();

  for (const rule of RULES) {
    const signals = rule.terms.filter((term) => matches(normalized, term));

    if (signals.length > 0) {
      return classifyResearchRequestOutputSchema.parse({
        depth: rule.depth,
        confidence: Math.min(1, 0.5 + signals.length * 0.2),
        signals,
      });
    }
  }

  return classifyResearchRequestOutputSchema.parse({
    depth: "unknown",
    confidence: 0,
    signals: [],
  });
}

class ClassifyResearchRequestTool
  implements Tool<ClassifyResearchRequestInput, ClassifyResearchRequestOutput>
{
  public readonly manifest = classifyResearchRequestManifest;
  public readonly inputSchema = classifyResearchRequestInputSchema;
  public readonly outputSchema = classifyResearchRequestOutputSchema;

  public execute(input: ClassifyResearchRequestInput): Promise<ClassifyResearchRequestOutput> {
    return Promise.resolve(classify(input.request));
  }
}

export const classifyResearchRequestTool: Tool<
  ClassifyResearchRequestInput,
  ClassifyResearchRequestOutput
> = new ClassifyResearchRequestTool();
