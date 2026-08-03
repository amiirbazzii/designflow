// workflows/workflow-design-to-code/src/capabilities/index.ts
import { z } from "zod";
import type { Capability, CapabilityContext } from "@designflow/sdk";
import {
  ARTIFACT_IDS,
  ARTIFACT_TYPES,
  capabilityOutputSchema,
  componentTreeSchema,
  designAnalysisSchema,
  designTokensSchema,
  designToCodeInputSchema,
  sourceCodeSchema,
  validationReportSchema,
  type ComponentTree,
  type DesignAnalysis,
  type DesignTokens,
  type SourceCode,
  type ValidationReport,
  type CapabilityOutput,
} from "../types";
import { readArtifact, writeArtifact } from "../artifact-io";

/**
 * The five capabilities of the Design → Code workflow.
 *
 * Every one of them is a **pure function of its inputs**. No timestamps, no
 * randomness, no ambient state. That is not incidental tidiness: artifact
 * versioning compares a re-emitted artifact's metadata against the previous
 * version, so a capability that varied its output run to run would report a
 * change every time and make incremental reuse impossible.
 *
 * They are also `type: "pure"` except `generate-code`, which is the step that
 * would write to a project and is therefore the natural approval gate.
 */

/** Stable, order-independent list. Keeps derived output deterministic. */
function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

// ── 1. Analyze Design ────────────────────────────────────────────

export const analyzeDesignCapability: Capability<unknown, CapabilityOutput> = {
  id: "analyze-design",
  name: "Analyze design",
  description: "Reads a design file and identifies its components and token usage",
  type: "pure",
  version: "1",
  inputSchema: designToCodeInputSchema,
  outputSchema: capabilityOutputSchema,

  async execute(
    context: CapabilityContext,
    input: unknown,
  ): Promise<CapabilityOutput> {
    const parsed = designToCodeInputSchema.parse(input);

    const components = parsed.frames.map((frame) => ({
      name: frame.split("/").slice(-1)[0] ?? frame,
      depth: frame.split("/").length - 1,
    }));

    const analysis: DesignAnalysis = designAnalysisSchema.parse({
      designFile: parsed.designFile,
      components,
      tokens: sortedUnique(
        parsed.frames.flatMap((frame) => frame.split("/").slice(0, -1)),
      ),
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.designAnalysis,
      artifactType: ARTIFACT_TYPES.designAnalysis,
      name: "Design analysis",
      payload: analysis,
      summary: {
        designFile: analysis.designFile,
        componentCount: analysis.components.length,
        tokenGroups: analysis.tokens,
      },
    });
  },
};

// ── 2. Extract Design Tokens ─────────────────────────────────────

export const extractDesignTokensCapability: Capability<unknown, CapabilityOutput> = {
  id: "extract-design-tokens",
  name: "Extract design tokens",
  description: "Derives colour, spacing and typography tokens from a design analysis",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const analysis = await readArtifact(
      context,
      ARTIFACT_IDS.designAnalysis,
      designAnalysisSchema,
    );

    // Token groups come from the design's own structure, so a design that did
    // not change produces byte-identical tokens and is reused.
    const groups = analysis.tokens;

    const tokens: DesignTokens = designTokensSchema.parse({
      colors: groups.map((group) => `color.${group}`),
      spacing: groups.map((group) => `space.${group}`),
      typography: groups.map((group) => `type.${group}`),
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.designTokens,
      artifactType: ARTIFACT_TYPES.designTokens,
      name: "Design tokens",
      payload: tokens,
      summary: {
        colorCount: tokens.colors.length,
        spacingCount: tokens.spacing.length,
        typographyCount: tokens.typography.length,
      },
    });
  },
};

// ── 3. Create Component Structure ────────────────────────────────

export const createComponentStructureCapability: Capability<unknown, CapabilityOutput> = {
  id: "create-component-structure",
  name: "Create component structure",
  description: "Builds a component tree from the analysis and the design tokens",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const analysis = await readArtifact(
      context,
      ARTIFACT_IDS.designAnalysis,
      designAnalysisSchema,
    );
    const tokens = await readArtifact(
      context,
      ARTIFACT_IDS.designTokens,
      designTokensSchema,
    );

    const framework = readFramework(context);

    const tree: ComponentTree = componentTreeSchema.parse({
      framework,
      components: analysis.components.map((component) => ({
        name: component.name,
        depth: component.depth,
        uses: tokens.colors.slice(0, component.depth + 1),
      })),
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.componentTree,
      artifactType: ARTIFACT_TYPES.componentTree,
      name: "Component structure",
      payload: tree,
      summary: {
        framework: tree.framework,
        componentCount: tree.components.length,
        componentNames: tree.components.map((component) => component.name),
      },
    });
  },
};

// ── 4. Generate Code ─────────────────────────────────────────────

export const generateCodeCapability: Capability<unknown, CapabilityOutput> = {
  id: "generate-code",
  name: "Generate code",
  description: "Emits source files for every component in the tree",
  // The step that would write into a project. Policies gate on this id.
  type: "write_fs",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const tree = await readArtifact(
      context,
      ARTIFACT_IDS.componentTree,
      componentTreeSchema,
    );

    const extension = tree.framework === "react" ? "tsx" : tree.framework;

    const code: SourceCode = sourceCodeSchema.parse({
      framework: tree.framework,
      files: tree.components.map((component) => ({
        path: `src/components/${component.name}.${extension}`,
        contents: renderComponent(component.name, component.uses),
      })),
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.sourceCode,
      artifactType: ARTIFACT_TYPES.sourceCode,
      name: "Generated source code",
      payload: code,
      summary: {
        framework: code.framework,
        fileCount: code.files.length,
        paths: code.files.map((file) => file.path),
      },
    });
  },
};

// ── 5. Validate Output ───────────────────────────────────────────

export const validateOutputCapability: Capability<unknown, CapabilityOutput> = {
  id: "validate-output",
  name: "Validate output",
  description: "Checks the generated source for structural problems",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,

  async execute(context: CapabilityContext): Promise<CapabilityOutput> {
    const code = await readArtifact(
      context,
      ARTIFACT_IDS.sourceCode,
      sourceCodeSchema,
    );

    const issues = code.files
      .filter((file) => file.contents.trim().length === 0)
      .map((file) => ({
        path: file.path,
        message: "Generated file is empty",
        severity: "error" as const,
      }));

    const report: ValidationReport = validationReportSchema.parse({
      passed: issues.length === 0,
      checked: code.files.length,
      issues,
    });

    return writeArtifact(context, {
      artifactId: ARTIFACT_IDS.validationReport,
      artifactType: ARTIFACT_TYPES.validationReport,
      name: "Validation report",
      payload: report,
      summary: {
        passed: report.passed,
        checked: report.checked,
        issueCount: report.issues.length,
      },
    });
  },
};

// ── Registry ─────────────────────────────────────────────────────

export const designToCodeCapabilities: readonly Capability<
  unknown,
  CapabilityOutput
>[] = [
  analyzeDesignCapability,
  extractDesignTokensCapability,
  createComponentStructureCapability,
  generateCodeCapability,
  validateOutputCapability,
];

// ── Helpers ──────────────────────────────────────────────────────

/**
 * The framework the run asked for.
 *
 * Read from execution config rather than passed between nodes, so changing it
 * invalidates the component tree without any node knowing about another.
 */
function readFramework(context: CapabilityContext): ComponentTree["framework"] {
  const parsed = designToCodeInputSchema
    .pick({ framework: true })
    .safeParse(readWorkflowInput(context));

  return parsed.success ? parsed.data.framework : "react";
}

function readWorkflowInput(context: CapabilityContext): unknown {
  return context.config.input;
}

function renderComponent(name: string, uses: readonly string[]): string {
  const tokens = uses.length > 0 ? uses.join(", ") : "none";

  return [
    `// Generated by DesignFlow`,
    `// Tokens: ${tokens}`,
    `export function ${name}() {`,
    `  return null;`,
    `}`,
    ``,
  ].join("\n");
}
