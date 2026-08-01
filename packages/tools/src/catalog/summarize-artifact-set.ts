// packages/tools/src/catalog/summarize-artifact-set.ts
import { toolManifestSchema } from "@designflow/sdk";
import type { Tool, ToolManifest } from "@designflow/sdk";
import { z } from "zod";

/**
 * Counts a set of implementation items by kind and renders a one-line summary.
 *
 * Pure arithmetic over the items it is handed — no filesystem, no network, no
 * clock. The same set of items produces the same counts and the same sentence
 * every time, so a reviewer agent can quote the summary without it drifting
 * between calls.
 */

const artifactItemSchema = z
  .object({
    path: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict();

export type ArtifactItem = z.infer<typeof artifactItemSchema>;

/** Bounded so a caller cannot turn a summary into an unbounded scan. */
const MAX_ITEMS = 2_000;

export const summarizeArtifactSetInputSchema = z
  .object({
    items: z.array(artifactItemSchema).max(MAX_ITEMS),
  })
  .strict();

export type SummarizeArtifactSetInput = z.infer<typeof summarizeArtifactSetInputSchema>;

export const summarizeArtifactSetOutputSchema = z
  .object({
    totalCount: z.number().int().nonnegative(),
    countsByKind: z.record(z.string(), z.number().int().nonnegative()),
    summary: z.string(),
  })
  .strict();

export type SummarizeArtifactSetOutput = z.infer<typeof summarizeArtifactSetOutputSchema>;

export const summarizeArtifactSetManifest: ToolManifest = toolManifestSchema.parse({
  id: "summarize-artifact-set",
  name: "Summarize artifact set",
  description: "Counts a set of implementation items by kind and renders a short summary",
  version: "0.1.0",
  inputSchema: {
    description: "The implementation items to summarize",
    fields: [
      {
        name: "items",
        type: "object",
        required: true,
        description: "Array of { path: string, kind: string }",
      },
    ],
  },
  outputSchema: {
    description: "Counts by kind, a total, and a deterministic sentence",
    fields: [
      { name: "totalCount", type: "number", required: true },
      { name: "countsByKind", type: "object", required: true },
      { name: "summary", type: "string", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

function summarize(input: SummarizeArtifactSetInput): SummarizeArtifactSetOutput {
  const countsByKind: Record<string, number> = {};

  for (const item of input.items) {
    countsByKind[item.kind] = (countsByKind[item.kind] ?? 0) + 1;
  }

  // Sorted by count descending, then kind name, so the sentence never
  // reorders itself between calls over the same input.
  const ordered = Object.entries(countsByKind).sort(([kindA, countA], [kindB, countB]) => {
    if (countA !== countB) return countB - countA;
    return kindA.localeCompare(kindB);
  });

  const totalCount = input.items.length;
  const kindCount = ordered.length;

  const summary =
    totalCount === 0
      ? "No artifacts."
      : `${totalCount} artifact${totalCount === 1 ? "" : "s"} across ${kindCount} kind${
          kindCount === 1 ? "" : "s"
        }: ${ordered.map(([kind, count]) => `${kind} (${count})`).join(", ")}.`;

  return summarizeArtifactSetOutputSchema.parse({ totalCount, countsByKind, summary });
}

class SummarizeArtifactSetTool
  implements Tool<SummarizeArtifactSetInput, SummarizeArtifactSetOutput>
{
  public readonly manifest = summarizeArtifactSetManifest;
  public readonly inputSchema = summarizeArtifactSetInputSchema;
  public readonly outputSchema = summarizeArtifactSetOutputSchema;

  public execute(input: SummarizeArtifactSetInput): Promise<SummarizeArtifactSetOutput> {
    return Promise.resolve(summarize(input));
  }
}

export const summarizeArtifactSetTool: Tool<
  SummarizeArtifactSetInput,
  SummarizeArtifactSetOutput
> = new SummarizeArtifactSetTool();
