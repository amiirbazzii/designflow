// workflows/workflow-design-to-code/src/figma-specification-types.ts
import { z } from "zod";
import { AGENT_FOUNDATION_ARTIFACT_IDS } from "../orchestration/agent-foundation-types";

/**
 * Types and stable artifact identity for `design-to-code-figma-specification`
 * — Stage 3's real, MCP-backed successor to Stage 2's fixture proof
 * workflow. Not the public `design-to-code` workflow, and not reachable
 * from the Design Engineer worker's `workflows` list; see the Stage 3 ADR
 * for the experimental rollout mechanism that does expose it.
 */

export const FIGMA_SPECIFICATION_ARTIFACT_IDS = {
  parsedSource: "parsed-figma-source",
  sourceSnapshot: "figma-source-snapshot",
  designSpecification: AGENT_FOUNDATION_ARTIFACT_IDS.designSpecification,
  stage3Summary: "stage-3-summary",
} as const;

export const FIGMA_SPECIFICATION_ARTIFACT_TYPES = {
  stage3Summary: "design.stage-3-summary",
} as const;

export const figmaSpecificationInputSchema = z
  .object({
    /** Worker-facing free text — a Figma URL, a bare file key, or (fixture mode only) a plain name. */
    designFile: z.string().min(1),
    frames: z.array(z.string().min(1)).default([]),
    captureScreenshots: z.boolean().default(true),
    /**
     * Forces a fresh retrieval even when nothing else about this node's
     * input changed. See `retrieveSnapshotInputSchema` in
     * `@designflow/capability-figma-mcp` for why this exists: a document
     * version discoverable only by fetching cannot invalidate reuse
     * automatically ahead of that fetch.
     */
    refreshFigmaSource: z.boolean().default(false),
    /** Internal/test-only — never set by a real production request. */
    allowFixtureNames: z.boolean().default(false),
    figmaSourceMode: z.enum(["placeholder", "rest", "mcp-stdio", "mcp-desktop"]).default("placeholder"),
    figmaSourceKind: z.enum(["current-selection", "figma-url"]).default("current-selection"),
    figmaServerIdentity: z.string().min(1).optional(),
    figmaCacheBypass: z.string().min(1).optional(),
    figmaAgentVersion: z.string().min(1),
    figmaAgentModelProfileId: z.string().min(1).optional(),
  })
  .strict();

export type FigmaSpecificationInput = z.infer<typeof figmaSpecificationInputSchema>;

export const stage3SummarySchema = z
  .object({
    fileKey: z.string().min(1),
    documentVersion: z.string().optional(),
    resolvedFrameCount: z.number().int().nonnegative(),
    componentCount: z.number().int().nonnegative(),
    ambiguityCount: z.number().int().nonnegative(),
    screenshotCount: z.number().int().nonnegative(),
  })
  .strict();

export type Stage3Summary = z.infer<typeof stage3SummarySchema>;
