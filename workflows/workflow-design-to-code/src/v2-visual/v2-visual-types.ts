// workflows/workflow-design-to-code/src/v2-visual/v2-visual-types.ts
import { z } from "zod";
import {
  implementationMapSchema,
  proposedFileChangesSchema,
  uiBlueprintSchema,
  visualViewportV1Schema,
} from "@designflow/sdk";

/**
 * The internal V2 visual stage.
 *
 * Internal on purpose: `designflow run design-engineer` still runs the
 * flagship V1 path. This exists so the V2 chain is executable and produces
 * real, resolvable artifacts, rather than being proven only by calling
 * functions in a unit test.
 */
export const V2_VISUAL_ARTIFACT_IDS = {
  blueprint: "ui-blueprint",
  projectContext: "project-context",
  implementationMap: "implementation-map",
  proposal: "builder-proposal",
  renderedState: "rendered-state",
  report: "visual-delta-report",
} as const;

export const V2_VISUAL_ARTIFACT_TYPES = {
  blueprint: "design.ui-blueprint",
  projectContext: "project.canonical-context",
  implementationMap: "implementation.map",
  proposal: "implementation.builder-proposal",
  renderedState: "implementation.rendered-state",
  report: "implementation.visual-delta-report",
} as const;

/**
 * A reference screenshot the design evidence already produced.
 *
 * Named by artifact id rather than carried inline: the canonical Figma
 * screenshot is already stored, and re-encoding it into a workflow input
 * would create a second copy whose identity nobody could check.
 */
export const v2ReferenceScreenshotSchema = z
  .object({
    viewportId: z.string().min(1).max(80),
    artifactId: z.string().min(1).max(200),
    evidenceId: z.string().min(1).max(200).optional(),
    fileKey: z.string().min(1).max(200).optional(),
    nodeId: z.string().min(1).max(200).optional(),
    captureMethod: z.string().min(1).max(120).optional(),
  })
  .strict();

export const v2VisualStageInputSchema = z
  .object({
    project: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        rootPath: z.string().min(1),
      })
      .strict(),
    blueprint: uiBlueprintSchema,
    projectContext: z.unknown(),
    implementationMap: implementationMapSchema,
    proposal: proposedFileChangesSchema,
    viewports: z.array(visualViewportV1Schema).min(1).max(8).optional(),
    route: z.string().min(1).max(200).optional(),
    /** Set false to render the proposal bytes with no correspondence markers. */
    instrument: z.boolean().optional(),
    referenceScreenshots: z.array(v2ReferenceScreenshotSchema).max(8).optional(),
    /** The design identity the Blueprint was compiled from. */
    designIdentity: z
      .object({ fileKey: z.string().min(1).max(200).optional(), nodeId: z.string().min(1).max(200).optional() })
      .strict()
      .optional(),
    expectedProjectFingerprint: z.string().min(1).max(200).optional(),
    currentProjectFingerprint: z.string().min(1).max(200).optional(),
  })
  .strict();

export type V2VisualStageInput = z.infer<typeof v2VisualStageInputSchema>;
