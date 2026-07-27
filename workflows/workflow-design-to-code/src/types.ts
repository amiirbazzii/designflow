import { z } from "zod";

/**
 * Domain contracts for the Design → Code workflow.
 *
 * Every artifact payload is validated at both ends: the capability that writes
 * it parses before saving, and the capability that reads it parses after
 * loading. Nodes never hand each other values — the artifact store is the only
 * channel between them, so a schema mismatch surfaces as a validation error
 * rather than a wrong result.
 */

// ── Workflow Input ───────────────────────────────────────────────

export const frameworkSchema = z.enum(["react", "vue", "svelte"]);

export type Framework = z.infer<typeof frameworkSchema>;

export const designToCodeInputSchema = z.object({
  /** Path or identifier of the design file to convert. */
  designFile: z.string().min(1),
  framework: frameworkSchema.default("react"),
  preferences: z
    .object({
      typescript: z.boolean().default(true),
      cssStrategy: z.enum(["css-modules", "tailwind", "styled"]).default("css-modules"),
    })
    .default({}),
  /**
   * The design's content, as a list of frame names.
   *
   * Stands in for parsing a real design file. Everything downstream is derived
   * from it, which is what makes a re-run with an unchanged design reuse
   * cleanly.
   */
  frames: z.array(z.string().min(1)).default([]),
});

export type DesignToCodeInput = z.infer<typeof designToCodeInputSchema>;

// ── Artifact Payloads ────────────────────────────────────────────

export const designAnalysisSchema = z.object({
  designFile: z.string().min(1),
  components: z.array(
    z.object({
      name: z.string().min(1),
      /** Frames whose name contains a separator are read as nested. */
      depth: z.number().int().nonnegative(),
    }),
  ),
  tokens: z.array(z.string().min(1)),
});

export type DesignAnalysis = z.infer<typeof designAnalysisSchema>;

export const designTokensSchema = z.object({
  colors: z.array(z.string().min(1)),
  spacing: z.array(z.string().min(1)),
  typography: z.array(z.string().min(1)),
});

export type DesignTokens = z.infer<typeof designTokensSchema>;

export const componentTreeSchema = z.object({
  framework: frameworkSchema,
  components: z.array(
    z.object({
      name: z.string().min(1),
      depth: z.number().int().nonnegative(),
      /** Token names this component is styled with. */
      uses: z.array(z.string().min(1)),
    }),
  ),
});

export type ComponentTree = z.infer<typeof componentTreeSchema>;

export const sourceCodeSchema = z.object({
  framework: frameworkSchema,
  files: z.array(
    z.object({
      path: z.string().min(1),
      contents: z.string(),
    }),
  ),
});

export type SourceCode = z.infer<typeof sourceCodeSchema>;

export const validationReportSchema = z.object({
  passed: z.boolean(),
  checked: z.number().int().nonnegative(),
  issues: z.array(
    z.object({
      path: z.string().min(1),
      message: z.string().min(1),
      severity: z.enum(["error", "warning"]),
    }),
  ),
});

export type ValidationReport = z.infer<typeof validationReportSchema>;

// ── Artifact Identity ────────────────────────────────────────────

/**
 * Stable logical ids for this workflow's artifacts.
 *
 * Distinct from the content-addressed id `ArtifactStore.save` returns. A
 * content hash changes whenever the bytes change, which makes it useless as a
 * name for "the design tokens of this project": incremental planning needs to
 * say "tokens changed", and versioning needs to know that v2 succeeds v1 of
 * *the same* artifact. These ids provide that identity; the hash identifies
 * the payload behind it.
 */
export const ARTIFACT_IDS = {
  designAnalysis: "design-analysis",
  designTokens: "design-tokens",
  componentTree: "component-tree",
  sourceCode: "source-code",
  validationReport: "validation-report",
} as const;

export const ARTIFACT_TYPES = {
  designAnalysis: "design.analysis",
  designTokens: "design.tokens",
  componentTree: "code.component-tree",
  sourceCode: "code.source",
  validationReport: "code.validation-report",
} as const;

// ── Capability Output ────────────────────────────────────────────

/** Every capability in this workflow returns exactly one artifact reference. */
export const capabilityOutputSchema = z.object({
  artifactRef: z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  }),
});

export type CapabilityOutput = z.infer<typeof capabilityOutputSchema>;
