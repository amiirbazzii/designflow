// packages/tools/src/catalog/structure-acceptance-criteria.ts
import {
  toolManifestSchema,
  type Tool,
  type ToolManifest,
} from "@designflow/sdk";

import { z } from "zod";

/**
 * Restructures free-text requirement wording into a measurable acceptance
 * criterion: Given/When/Then when the text names a trigger ("when...") and a
 * consequence, a plain checklist otherwise.
 *
 * A rule-based rewrite, not a summary — every line traces back to a slice of
 * the original text, split on fixed keywords. It will not always produce
 * elegant prose, and that is the trade for staying predictable: the same
 * input text produces the same structure every time.
 */

const MAX_TEXT_LENGTH = 2_000;

export const structureAcceptanceCriteriaInputSchema = z
  .object({
    requirementId: z.string().min(1),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
  })
  .strict();

export type StructureAcceptanceCriteriaInput = z.infer<
  typeof structureAcceptanceCriteriaInputSchema
>;

export const acceptanceCriteriaFormatSchema = z.enum(["given_when_then", "checklist"]);

export type AcceptanceCriteriaFormat = z.infer<typeof acceptanceCriteriaFormatSchema>;

export const structureAcceptanceCriteriaOutputSchema = z
  .object({
    requirementId: z.string(),
    format: acceptanceCriteriaFormatSchema,
    criteria: z.array(z.string()).min(1),
  })
  .strict();

export type StructureAcceptanceCriteriaOutput = z.infer<
  typeof structureAcceptanceCriteriaOutputSchema
>;

export const structureAcceptanceCriteriaManifest: ToolManifest = toolManifestSchema.parse({
  id: "structure-acceptance-criteria",
  name: "Structure acceptance criteria",
  description: "Restructures free requirement text into Given/When/Then or a checklist",
  version: "0.1.0",
  inputSchema: {
    description: "The requirement text to restructure",
    fields: [
      { name: "requirementId", type: "string", required: true, description: "The requirement this text belongs to" },
      { name: "text", type: "string", required: true, description: "The free-text wording to restructure" },
    ],
  },
  outputSchema: {
    description: "The restructured criterion, in one of two fixed formats",
    fields: [
      { name: "requirementId", type: "string", required: true },
      { name: "format", type: "string", required: true },
      { name: "criteria", type: "string[]", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

const WHEN_PATTERN = /\bwhen\b/i;
const THEN_PATTERN = /\bthen\b/i;
const SHOULD_MUST_PATTERN = /\b(should|must)\b/i;

function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

function buildChecklist(text: string): readonly string[] {
  const parts = text
    .split(/[.;]|\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.length > 0
    ? parts.map((part) => `- ${capitalize(part)}`)
    : [`- ${capitalize(text.trim())}`];
}

function buildGivenWhenThen(text: string): readonly string[] {
  const normalized = text.trim();
  const whenMatch = WHEN_PATTERN.exec(normalized);

  // Guarded by the caller, but kept honest: fall back rather than assume.
  if (!whenMatch) return buildChecklist(normalized);

  const whenStart = whenMatch.index;
  const givenPart = normalized.slice(0, whenStart).replace(/^given\s*/i, "").trim();
  const afterWhen = normalized.slice(whenStart + whenMatch[0].length).trim();

  const thenMatch = THEN_PATTERN.exec(afterWhen);
  let whenPart: string;
  let thenPart: string;

  if (thenMatch) {
    whenPart = afterWhen.slice(0, thenMatch.index).trim();
    thenPart = afterWhen.slice(thenMatch.index + thenMatch[0].length).trim();
  } else {
    const shouldMatch = SHOULD_MUST_PATTERN.exec(afterWhen);
    if (shouldMatch) {
      whenPart = afterWhen.slice(0, shouldMatch.index).trim();
      thenPart = afterWhen.slice(shouldMatch.index).trim();
    } else {
      whenPart = afterWhen;
      thenPart = "the expected outcome occurs";
    }
  }

  return [
    `Given ${givenPart.length > 0 ? givenPart : "the current state"}`,
    `When ${whenPart.length > 0 ? whenPart : "the described trigger occurs"}`,
    `Then ${thenPart.length > 0 ? thenPart : "the expected outcome occurs"}`,
  ];
}

function structure(input: StructureAcceptanceCriteriaInput): StructureAcceptanceCriteriaOutput {
  const hasTrigger = WHEN_PATTERN.test(input.text);
  const hasConsequence = THEN_PATTERN.test(input.text) || SHOULD_MUST_PATTERN.test(input.text);

  if (hasTrigger && hasConsequence) {
    return structureAcceptanceCriteriaOutputSchema.parse({
      requirementId: input.requirementId,
      format: "given_when_then",
      criteria: buildGivenWhenThen(input.text),
    });
  }

  return structureAcceptanceCriteriaOutputSchema.parse({
    requirementId: input.requirementId,
    format: "checklist",
    criteria: buildChecklist(input.text),
  });
}

class StructureAcceptanceCriteriaTool
  implements Tool<StructureAcceptanceCriteriaInput, StructureAcceptanceCriteriaOutput>
{
  public readonly manifest = structureAcceptanceCriteriaManifest;
  public readonly inputSchema = structureAcceptanceCriteriaInputSchema;
  public readonly outputSchema = structureAcceptanceCriteriaOutputSchema;

  public execute(
    input: StructureAcceptanceCriteriaInput,
  ): Promise<StructureAcceptanceCriteriaOutput> {
    return Promise.resolve(structure(input));
  }
}

export const structureAcceptanceCriteriaTool: Tool<
  StructureAcceptanceCriteriaInput,
  StructureAcceptanceCriteriaOutput
> = new StructureAcceptanceCriteriaTool();
