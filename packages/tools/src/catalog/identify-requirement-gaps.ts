// packages/tools/src/catalog/identify-requirement-gaps.ts
import { toolManifestSchema } from "@designflow/sdk";
import type { Tool, ToolManifest } from "@designflow/sdk";
import { z } from "zod";

/**
 * Flags gaps in a list of requirements: no priority, no reference to
 * acceptance criteria, or wording similar enough to another requirement that
 * it may be a duplicate.
 *
 * Similarity is plain word-overlap (Jaccard over lowercased word sets), not
 * semantic matching — two requirements about unrelated things that happen to
 * share many common words can still trip it, and that is the honest
 * trade-off of staying rule-based rather than reaching for a model here.
 */

const MAX_REQUIREMENTS = 500;

const requirementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1).max(2_000),
    priority: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
  })
  .strict();

export type RequirementInput = z.infer<typeof requirementSchema>;

export const identifyRequirementGapsInputSchema = z
  .object({
    requirements: z.array(requirementSchema).max(MAX_REQUIREMENTS),
  })
  .strict();

export type IdentifyRequirementGapsInput = z.infer<typeof identifyRequirementGapsInputSchema>;

const requirementGapSchema = z
  .object({
    id: z.string(),
    missingPriority: z.boolean(),
    missingAcceptanceCriteria: z.boolean(),
    /** Ids of other requirements this one closely resembles. */
    possibleDuplicateOf: z.array(z.string()).default([]),
  })
  .strict();

export type RequirementGap = z.infer<typeof requirementGapSchema>;

export const identifyRequirementGapsOutputSchema = z
  .object({
    gaps: z.array(requirementGapSchema),
    gapCount: z.number().int().nonnegative(),
  })
  .strict();

export type IdentifyRequirementGapsOutput = z.infer<typeof identifyRequirementGapsOutputSchema>;

export const identifyRequirementGapsManifest: ToolManifest = toolManifestSchema.parse({
  id: "identify-requirement-gaps",
  name: "Identify requirement gaps",
  description: "Flags missing priority, missing acceptance criteria, and likely duplicate requirements",
  version: "0.1.0",
  inputSchema: {
    description: "The requirements to check",
    fields: [
      {
        name: "requirements",
        type: "object",
        required: true,
        description: "Array of { id, text, priority?, acceptanceCriteria? }",
      },
    ],
  },
  outputSchema: {
    description: "Per-requirement gap flags, plus a total gap count",
    fields: [
      { name: "gaps", type: "object", required: true },
      { name: "gapCount", type: "number", required: true },
    ],
  },
  timeoutMs: 2_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

/** Requirements whose word-overlap similarity meets or exceeds this read as possible duplicates. */
const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** Jaccard similarity: the fraction of the combined vocabulary the two sets share. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function identify(input: IdentifyRequirementGapsInput): IdentifyRequirementGapsOutput {
  const wordSets = input.requirements.map((requirement) => wordSet(requirement.text));

  const gaps = input.requirements.map((requirement, index) => {
    const possibleDuplicateOf: string[] = [];

    for (let other = 0; other < input.requirements.length; other += 1) {
      if (other === index) continue;
      const sim = similarity(wordSets[index]!, wordSets[other]!);
      if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
        possibleDuplicateOf.push(input.requirements[other]!.id);
      }
    }

    return {
      id: requirement.id,
      missingPriority: requirement.priority === undefined || requirement.priority.trim().length === 0,
      missingAcceptanceCriteria:
        requirement.acceptanceCriteria === undefined || requirement.acceptanceCriteria.trim().length === 0,
      possibleDuplicateOf,
    };
  });

  const gapCount = gaps.reduce(
    (count, gap) =>
      count +
      (gap.missingPriority ? 1 : 0) +
      (gap.missingAcceptanceCriteria ? 1 : 0) +
      (gap.possibleDuplicateOf.length > 0 ? 1 : 0),
    0,
  );

  return identifyRequirementGapsOutputSchema.parse({ gaps, gapCount });
}

class IdentifyRequirementGapsTool
  implements Tool<IdentifyRequirementGapsInput, IdentifyRequirementGapsOutput>
{
  public readonly manifest = identifyRequirementGapsManifest;
  public readonly inputSchema = identifyRequirementGapsInputSchema;
  public readonly outputSchema = identifyRequirementGapsOutputSchema;

  public execute(input: IdentifyRequirementGapsInput): Promise<IdentifyRequirementGapsOutput> {
    return Promise.resolve(identify(input));
  }
}

export const identifyRequirementGapsTool: Tool<
  IdentifyRequirementGapsInput,
  IdentifyRequirementGapsOutput
> = new IdentifyRequirementGapsTool();
