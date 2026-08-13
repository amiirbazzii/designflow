// packages/sdk/src/implementation-map/mapping-patch-schema.ts
import { z } from "zod";
import {
  mappingActionSchema,
  mappingCompatibilitySchema,
  mappingUncertaintySchema,
} from "./implementation-map-schema";

/**
 * The mapping patch — the only thing the Project Mapper may author.
 *
 * The same shape the Design Interpreter's semantic patch takes, one layer
 * further down the pipeline: the deterministic host builds a skeleton holding
 * every requirement and every candidate, and the model answers with
 * *decisions keyed by those ids*. It selects a candidate; it never names a
 * path. It chooses an action; it never writes a component.
 *
 * Two things this schema structurally cannot express:
 *
 *   a project fact   there is no free-form path, token or route field. A
 *                    component the project does not have has no id to name,
 *                    so it cannot be referenced into existence.
 *
 *   code             no field holds a file body, JSX, CSS or a patch. The
 *                    longest string here is a 400-character reason.
 */

export const MAPPING_PATCH_SCHEMA_VERSION = "1";

export const componentDecisionSchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    action: mappingActionSchema,
    /** Required for reuse/extend; must be one of the host's offered candidates. */
    candidateId: z.string().min(1).max(200).optional(),
    /** Required for create; must be one of the host's planned directories. */
    plannedDirectoryId: z.string().min(1).max(200).optional(),
    /** The new component's name for a `create`. Never a path. */
    plannedName: z.string().min(1).max(120).optional(),
    compatibility: mappingCompatibilitySchema,
    requiredAdaptations: z.array(z.string().min(1).max(240)).max(12).default([]),
    reason: z.string().min(1).max(400),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export const destinationDecisionSchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    action: z.enum(["use_existing", "create_route", "create_page", "integrate_existing_root"]),
    candidateId: z.string().min(1).max(200),
    compositionRootCandidateId: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(400),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export const styleDecisionSchema = z
  .object({
    designValue: z.string().min(1).max(200),
    category: z.string().min(1).max(40),
    strategy: z.enum(["reuse_token", "reuse_style", "raw_design_value", "extend_token"]),
    /** Host-offered token id, required by every strategy except a raw value. */
    projectTokenId: z.string().min(1).max(200).optional(),
    equivalence: z.enum(["exact", "within-tolerance"]).optional(),
    reason: z.string().min(1).max(240),
  })
  .strict();

export const assetDecisionSchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    strategy: z.enum([
      "reuse_project_asset",
      "reuse_project_icon",
      "use_design_asset",
      "create_local_asset",
      "runtime_reference",
      "unresolved",
    ]),
    projectAssetId: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(240),
  })
  .strict();

/**
 * Composition is expressed as ordering and parenting over ids the skeleton
 * already contains — so a composition can arrange the screen but cannot
 * invent a part of it.
 */
export const compositionDecisionSchema = z
  .object({
    blueprintRef: z.string().min(1).max(200),
    order: z.number().int().nonnegative(),
    componentRequirementId: z.string().min(1).max(200).optional(),
    childRefs: z.array(z.string().min(1).max(200)).max(64).default([]),
  })
  .strict();

export const mappingPatchSchema = z
  .object({
    schemaVersion: z.literal(MAPPING_PATCH_SCHEMA_VERSION),
    partitionId: z.string().min(1).max(160),
    componentDecisions: z.array(componentDecisionSchema).max(64).default([]),
    destinationDecision: destinationDecisionSchema.optional(),
    styleDecisions: z.array(styleDecisionSchema).max(64).default([]),
    assetDecisions: z.array(assetDecisionSchema).max(32).default([]),
    compositionDecisions: z.array(compositionDecisionSchema).max(64).default([]),
    uncertainties: z.array(mappingUncertaintySchema).max(32).default([]),
  })
  .strict();

export type MappingPatch = z.infer<typeof mappingPatchSchema>;
export type ComponentDecision = z.infer<typeof componentDecisionSchema>;
export type DestinationDecision = z.infer<typeof destinationDecisionSchema>;
export type StyleDecision = z.infer<typeof styleDecisionSchema>;
export type AssetDecision = z.infer<typeof assetDecisionSchema>;

/**
 * Field names that carry host-owned facts or executable content.
 *
 * The patch schema above is `.strict()` and has none of them, so a patch
 * carrying one is already rejected at parse. The merge scans raw input
 * against this list as well — the same defence-in-depth the Blueprint's
 * fact-override guard applies, for the same reason: this is the boundary
 * where a model could otherwise smuggle in a project fact it invented.
 */
export const MAPPING_PATCH_FORBIDDEN_FIELDS: readonly string[] = Object.freeze([
  "requirements",
  "candidates",
  "destinationCandidates",
  "plannedDirectories",
  "projectTokens",
  "projectAssets",
  "binding",
  "projectFingerprint",
  "projectRootIdentity",
  // `blueprintRef` is deliberately NOT here: a composition decision must be
  // able to name which Blueprint entity it arranges. It is a selection among
  // ids the draft already contains, checked against them in the merge — the
  // same discipline as candidate ids, not free authorship.
  "path",
  "projectPath",
  "plannedPath",
  "projectTarget",
  "exportName",
  "content",
  "source",
  "code",
  "jsx",
  "tsx",
  "css",
  "patch",
  "diff",
  "command",
  "files",
  "coverage",
  "provenance",
]);

/** Markers that betray code smuggled into a bounded prose field. */
export const MAPPING_PATCH_CODE_MARKERS: readonly RegExp[] = Object.freeze([
  /<\/?[A-Za-z][A-Za-z0-9]*[^>]*>/,
  /\bimport\s+[\w{*\s,}]+\s+from\s+["']/,
  /\bexport\s+(?:default|const|function|class)\b/,
  /\bfunction\s+\w*\s*\([^)]*\)\s*\{/,
  /=>\s*\{/,
  /\{\s*[\w-]+\s*:\s*[^}]+;\s*\}/,
]);
