// packages/tools/src/catalog/accessibility-checklist.ts
import { toolManifestSchema } from "@designflow/sdk";
import type { Tool, ToolManifest } from "@designflow/sdk";
import { z } from "zod";

/**
 * Checks whether a request or a set of implementation notes mentions each of
 * four fixed accessibility categories: aria, contrast, keyboard, semantics.
 *
 * The checklist itself never changes — it is not derived from the input, only
 * scored against it — so the same four rows come back every time and a
 * reviewer can compare requests to each other over time. Keyword presence
 * only; this does not inspect markup or colors and never claims to.
 */

const CATEGORIES = ["aria", "contrast", "keyboard", "semantics"] as const;

export const accessibilityCategorySchema = z.enum(CATEGORIES);

export type AccessibilityCategory = z.infer<typeof accessibilityCategorySchema>;

export const accessibilityStatusSchema = z.enum(["mentioned", "not_mentioned"]);

export type AccessibilityStatus = z.infer<typeof accessibilityStatusSchema>;

export const accessibilityChecklistInputSchema = z
  .object({
    request: z.string().min(1).max(10_000),
    /** Additional free-text notes to scan alongside the request, if any. */
    items: z.array(z.string().max(2_000)).max(500).optional(),
  })
  .strict();

export type AccessibilityChecklistInput = z.infer<typeof accessibilityChecklistInputSchema>;

const checklistEntrySchema = z
  .object({
    category: accessibilityCategorySchema,
    status: accessibilityStatusSchema,
    signals: z.array(z.string()).default([]),
  })
  .strict();

export type AccessibilityChecklistEntry = z.infer<typeof checklistEntrySchema>;

export const accessibilityChecklistOutputSchema = z
  .object({
    checklist: z.array(checklistEntrySchema),
    /** Fraction of the four categories that were mentioned. */
    coverageScore: z.number().min(0).max(1),
  })
  .strict();

export type AccessibilityChecklistOutput = z.infer<typeof accessibilityChecklistOutputSchema>;

export const accessibilityChecklistManifest: ToolManifest = toolManifestSchema.parse({
  id: "accessibility-checklist",
  name: "Accessibility checklist",
  description: "Flags which fixed accessibility categories a request mentions",
  version: "0.1.0",
  inputSchema: {
    description: "The request to scan, plus optional extra notes",
    fields: [
      { name: "request", type: "string", required: true, description: "The text to scan" },
      {
        name: "items",
        type: "string[]",
        required: false,
        description: "Additional free-text notes to scan alongside the request",
      },
    ],
  },
  outputSchema: {
    description: "The fixed four-category checklist, each flagged, and a coverage score",
    fields: [
      { name: "checklist", type: "object", required: true },
      { name: "coverageScore", type: "number", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

const KEYWORDS: Record<AccessibilityCategory, readonly string[]> = {
  aria: ["aria", "aria-label", "aria-labelledby", "screen reader", "sr-only", "assistive technology"],
  contrast: ["contrast", "color contrast", "wcag aa", "wcag", "luminance", "color blind"],
  keyboard: ["keyboard", "tab order", "focus", "focus ring", "keyboard navigation", "enter key", "tabindex"],
  semantics: ["semantic", "heading", "landmark", "semantic html", "alt text", "alt=", "html5"],
};

function matches(haystack: string, term: string): boolean {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack);
}

function buildChecklist(text: string): AccessibilityChecklistOutput {
  const normalized = text.toLowerCase();

  const checklist = CATEGORIES.map((category) => {
    const signals = KEYWORDS[category].filter((term) => matches(normalized, term));

    return {
      category,
      status: signals.length > 0 ? ("mentioned" as const) : ("not_mentioned" as const),
      signals,
    };
  });

  const mentionedCount = checklist.filter((entry) => entry.status === "mentioned").length;

  return accessibilityChecklistOutputSchema.parse({
    checklist,
    coverageScore: mentionedCount / CATEGORIES.length,
  });
}

class AccessibilityChecklistTool
  implements Tool<AccessibilityChecklistInput, AccessibilityChecklistOutput>
{
  public readonly manifest = accessibilityChecklistManifest;
  public readonly inputSchema = accessibilityChecklistInputSchema;
  public readonly outputSchema = accessibilityChecklistOutputSchema;

  public execute(input: AccessibilityChecklistInput): Promise<AccessibilityChecklistOutput> {
    const text = [input.request, ...(input.items ?? [])].join(" ");
    return Promise.resolve(buildChecklist(text));
  }
}

export const accessibilityChecklistTool: Tool<
  AccessibilityChecklistInput,
  AccessibilityChecklistOutput
> = new AccessibilityChecklistTool();
