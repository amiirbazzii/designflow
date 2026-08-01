// packages/tools/src/catalog/validate-source-metadata.ts
import {
  toolManifestSchema,
  type Tool,
  type ToolManifest,
} from "@designflow/sdk";

import { z } from "zod";

/**
 * Checks a list of supplied sources for missing or malformed metadata.
 *
 * Purely structural: it looks at the shape of what was handed in — is there a
 * title, is there content, does the url look like a url — and never fetches
 * anything. A source can pass this check and still be wrong; all this proves
 * is that it is not obviously incomplete.
 */

const MAX_SOURCES = 500;

const sourceSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

export type SupplierSource = z.infer<typeof sourceSchema>;

export const validateSourceMetadataInputSchema = z
  .object({
    sources: z.array(sourceSchema).max(MAX_SOURCES),
  })
  .strict();

export type ValidateSourceMetadataInput = z.infer<typeof validateSourceMetadataInputSchema>;

const sourceIssueSchema = z.enum([
  "missing_title",
  "missing_content",
  "content_too_short",
  "missing_url",
  "invalid_url_format",
  "duplicate_id",
]);

export type SourceIssue = z.infer<typeof sourceIssueSchema>;

const sourceValidationResultSchema = z
  .object({
    id: z.string(),
    valid: z.boolean(),
    issues: z.array(sourceIssueSchema),
  })
  .strict();

export type SourceValidationResult = z.infer<typeof sourceValidationResultSchema>;

export const validateSourceMetadataOutputSchema = z
  .object({
    results: z.array(sourceValidationResultSchema),
    validCount: z.number().int().nonnegative(),
    invalidCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

export type ValidateSourceMetadataOutput = z.infer<typeof validateSourceMetadataOutputSchema>;

export const validateSourceMetadataManifest: ToolManifest = toolManifestSchema.parse({
  id: "validate-source-metadata",
  name: "Validate source metadata",
  description: "Flags sources with missing or malformed metadata, structurally, without fetching them",
  version: "0.1.0",
  inputSchema: {
    description: "The sources to validate",
    fields: [
      {
        name: "sources",
        type: "object",
        required: true,
        description: "Array of { id, title?, content?, url? }",
      },
    ],
  },
  outputSchema: {
    description: "Per-source validity, plus overall counts",
    fields: [
      { name: "results", type: "object", required: true },
      { name: "validCount", type: "number", required: true },
      { name: "invalidCount", type: "number", required: true },
      { name: "totalCount", type: "number", required: true },
    ],
  },
  timeoutMs: 1_000,
  metadata: { author: "DesignFlow", deterministic: true, readOnly: true },
});

const MIN_CONTENT_LENGTH = 20;
const URL_PATTERN = /^https?:\/\/.+/i;

function validateOne(source: SupplierSource, seenIds: Set<string>): SourceValidationResult {
  const issues: SourceIssue[] = [];

  if (seenIds.has(source.id)) {
    issues.push("duplicate_id");
  }
  seenIds.add(source.id);

  if (source.title === undefined || source.title.trim().length === 0) {
    issues.push("missing_title");
  }

  if (source.content === undefined || source.content.trim().length === 0) {
    issues.push("missing_content");
  } else if (source.content.trim().length < MIN_CONTENT_LENGTH) {
    issues.push("content_too_short");
  }

  if (source.url === undefined || source.url.trim().length === 0) {
    issues.push("missing_url");
  } else if (!URL_PATTERN.test(source.url.trim())) {
    issues.push("invalid_url_format");
  }

  return { id: source.id, valid: issues.length === 0, issues };
}

function validate(input: ValidateSourceMetadataInput): ValidateSourceMetadataOutput {
  const seenIds = new Set<string>();
  const results = input.sources.map((source) => validateOne(source, seenIds));
  const validCount = results.filter((result) => result.valid).length;

  return validateSourceMetadataOutputSchema.parse({
    results,
    validCount,
    invalidCount: results.length - validCount,
    totalCount: results.length,
  });
}

class ValidateSourceMetadataTool
  implements Tool<ValidateSourceMetadataInput, ValidateSourceMetadataOutput>
{
  public readonly manifest = validateSourceMetadataManifest;
  public readonly inputSchema = validateSourceMetadataInputSchema;
  public readonly outputSchema = validateSourceMetadataOutputSchema;

  public execute(input: ValidateSourceMetadataInput): Promise<ValidateSourceMetadataOutput> {
    return Promise.resolve(validate(input));
  }
}

export const validateSourceMetadataTool: Tool<
  ValidateSourceMetadataInput,
  ValidateSourceMetadataOutput
> = new ValidateSourceMetadataTool();
