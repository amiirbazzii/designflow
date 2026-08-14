// workflows/workflow-design-to-code/src/flagship/flagship-types.ts
import { z } from "zod";
import {
  visualViewportV1Schema,
  type ImplementationMap,
  type ProposedFileChanges,
  type UIBlueprint,
} from "@designflow/sdk";

import { implementationDestinationSchema } from "../implementation/implementation-types";
import { v2ReferenceScreenshotSchema } from "../v2-visual/v2-visual-types";

/**
 * The flagship Design-to-Code V2 workflow (V2-8).
 *
 * One logical execution: Figma evidence → Blueprint → Project Context →
 * Implementation Map → UI Builder → bounded visual convergence → exact
 * review → human approval → snapshot → apply → validation. The user's two
 * product decisions — which design, and where it goes — arrive as input;
 * everything else is discovered or compiled.
 *
 * The workflow id is internal; the public identity remains the
 * `design-engineer` worker. No Coordinator decision exists anywhere in this
 * path.
 */
export const DESIGN_TO_CODE_V2_WORKFLOW_ID = "design-to-code-v2";

export const flagshipInputSchema = z
  .object({
    project: z.object({ id: z.string().min(1), name: z.string().min(1), rootPath: z.string().min(1) }).strict(),
    stateDirectory: z.string().min(1),
    designFile: z.string().min(1),
    frames: z.array(z.string().min(1)).default([]),
    /** The user's destination decision — immutable host constraint (§7). */
    destination: implementationDestinationSchema,
    viewports: z.array(visualViewportV1Schema).min(1).max(8).optional(),
    route: z.string().min(1).max(200).optional(),
    instrument: z.boolean().optional(),
    maxEvaluatedStates: z.number().int().positive().max(3).optional(),
    designIdentity: z
      .object({ fileKey: z.string().min(1).max(200).optional(), nodeId: z.string().min(1).max(200).optional() })
      .strict()
      .optional(),
    referenceScreenshots: z.array(v2ReferenceScreenshotSchema).max(8).optional(),
    // Figma acquisition fields, in the vocabulary the existing capabilities
    // already map from workflow input.
    captureScreenshots: z.boolean().default(true),
    refreshFigmaSource: z.boolean().default(false),
    allowFixtureNames: z.boolean().default(false),
    figmaSourceMode: z.enum(["placeholder", "rest", "mcp-stdio", "mcp-desktop"]).default("placeholder"),
    figmaSourceKind: z.enum(["current-selection", "figma-url"]).default("current-selection"),
    figmaServerIdentity: z.string().min(1).optional(),
    figmaCacheBypass: z.string().min(1).optional(),
  })
  .passthrough();

export type FlagshipInput = z.infer<typeof flagshipInputSchema>;

// ── Deterministic seams ─────────────────────────────────────────
//
// The four V2 stages that live in other packages arrive injected through
// `context.config`, exactly the way `visualRenderer` / `visualEvaluator` /
// `visualRepairBuilder` already do. The composition root wires production
// implementations; tests wire deterministic fakes. The workflow package
// itself depends on the SDK alone.

export interface V2BlueprintCompilation {
  readonly blueprint: UIBlueprint;
  /** Honest semantic status: enrichment is additive, never load-bearing. */
  readonly semanticStatus: "not_requested" | "enriched" | "partial" | "unavailable";
}

export interface V2BlueprintCompiler {
  (input: { readonly snapshot: unknown; readonly snapshotArtifactId: string }): Promise<V2BlueprintCompilation>;
}

export interface V2ProjectContextCompiler {
  (input: { readonly project: { readonly id: string; readonly name: string; readonly rootPath: string } }): Promise<{
    readonly context: unknown;
  }>;
}

export interface V2ProjectMapperResult {
  readonly status: "complete" | "unavailable" | "failed";
  readonly map?: ImplementationMap;
  readonly reason?: string;
}

export interface V2ProjectMapper {
  (input: {
    readonly blueprint: UIBlueprint;
    readonly projectContext: unknown;
    readonly destination: z.infer<typeof implementationDestinationSchema>;
    readonly project: { readonly id: string; readonly name: string; readonly rootPath: string };
  }): Promise<V2ProjectMapperResult>;
}

export interface V2UiBuilderResult {
  readonly status: "valid" | "exhausted" | "unavailable" | "map_unexecutable" | "stale_project";
  readonly proposal?: ProposedFileChanges;
  readonly attempts: number;
  readonly reason?: string;
}

export interface V2UiBuilder {
  (input: {
    readonly blueprint: UIBlueprint;
    readonly map: ImplementationMap;
    readonly projectContext: unknown;
    readonly project: { readonly id: string; readonly name: string; readonly rootPath: string };
  }): Promise<V2UiBuilderResult>;
}

function seam<T>(value: unknown): T | undefined {
  return typeof value === "function" ? (value as T) : undefined;
}

export const configuredBlueprintCompiler = (value: unknown): V2BlueprintCompiler | undefined =>
  seam<V2BlueprintCompiler>(value);
export const configuredProjectContextCompiler = (value: unknown): V2ProjectContextCompiler | undefined =>
  seam<V2ProjectContextCompiler>(value);
export const configuredProjectMapper = (value: unknown): V2ProjectMapper | undefined =>
  seam<V2ProjectMapper>(value);
export const configuredUiBuilder = (value: unknown): V2UiBuilder | undefined => seam<V2UiBuilder>(value);
