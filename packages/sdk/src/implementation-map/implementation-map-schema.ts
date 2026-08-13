// packages/sdk/src/implementation-map/implementation-map-schema.ts
import { z } from "zod";

/**
 * The Implementation Map (Agent Architecture V2, phase V2-3).
 *
 *   UIBlueprint  (design truth)   +   CanonicalProjectContext  (project truth)
 *                              ↓
 *                        Project Mapper
 *                              ↓
 *                       ImplementationMap
 *
 * The answer to "how should this design be realized inside *this* project?" —
 * reuse, extend or create per component; where the screen becomes reachable;
 * how design foundations map onto the project's own tokens; what the page
 * composes into. It is a machine-executable plan, not a planning document:
 * the UI Builder (V2-4) executes it without re-deciding the architecture.
 *
 * Two structural guarantees, both enforced by this schema rather than by
 * convention:
 *
 *   no code   there is no field anywhere here capable of holding JSX, CSS, a
 *             file body, a patch or a shell command. A mapper that wants to
 *             write code has nowhere to put it.
 *
 *   no facts  every project reference is an id the deterministic host minted
 *             from ProjectContext — never a free path. A component or
 *             destination the project does not have cannot be named.
 */

export const IMPLEMENTATION_MAP_SCHEMA_VERSION = "1";

/** Artifact identity for the per-run map. Capability wiring lands with V2-4. */
export const IMPLEMENTATION_MAP_ARTIFACT_ID = "implementation-map";
export const IMPLEMENTATION_MAP_ARTIFACT_TYPE = "design.implementation-map";

// ── Binding ─────────────────────────────────────────────────────

/**
 * Which design, and which project state, this plan was made for.
 *
 * The Builder must be able to answer "is this plan still about the thing in
 * front of me?" without re-deriving anything. Note this only *carries* the
 * project fingerprint — approval-time verification stays where it already
 * lives (see the V2-7 consolidation debt in the ADR); a fifth copy of that
 * check is exactly what this file must not become.
 */
export const implementationMapBindingSchema = z
  .object({
    blueprintArtifactId: z.string().min(1).max(200).optional(),
    blueprintCompilerVersion: z.string().min(1).max(40),
    blueprintScreenNodeId: z.string().min(1).max(200),
    /** `completed | partial | unavailable | not_requested` at mapping time. */
    blueprintSemanticStatus: z.string().min(1).max(40),
    projectContextArtifactId: z.string().min(1).max(200).optional(),
    projectContextCompilerVersion: z.string().min(1).max(40),
    projectRootIdentity: z.string().min(1).max(200),
    /** The project state this plan describes. Carried, never re-verified here. */
    projectFingerprint: z.string().min(1).max(200).optional(),
  })
  .strict();

export type ImplementationMapBinding = z.infer<typeof implementationMapBindingSchema>;

// ── Bounds ──────────────────────────────────────────────────────

export const mappingBoundSchema = z
  .object({
    collection: z.string().min(1).max(80),
    discoveredCount: z.number().int().nonnegative().optional(),
    retainedCount: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative().optional(),
    truncated: z.boolean(),
    selectionRule: z.string().min(1).max(200),
  })
  .strict();

export type MappingBound = z.infer<typeof mappingBoundSchema>;

// ── Candidates (host-minted, the only referenceable project facts) ──

export const mappingCandidateSchema = z
  .object({
    /** Host-minted id. A patch selects this; it never names a path. */
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    path: z.string().min(1).max(400),
    exportName: z.string().min(1).max(160).optional(),
    designSystemMember: z.boolean().default(false),
    /** Why the host offered it — deterministic, never a model's opinion. */
    matchReason: z.string().min(1).max(200),
    matchScore: z.number().min(0).max(1),
    /** Confidence of the underlying ProjectContext fact this rests on. */
    factConfidence: z.enum(["deterministic", "high", "heuristic"]),
  })
  .strict();

export type MappingCandidate = z.infer<typeof mappingCandidateSchema>;

export const destinationCandidateSchema = z
  .object({
    id: z.string().min(1).max(200),
    path: z.string().min(1).max(400),
    kind: z.enum(["page", "component", "composition-root", "candidate-directory", "planned-path"]),
    route: z.string().min(1).max(200).optional(),
    status: z.enum(["existing", "candidate-directory", "route-convention", "planned"]),
    factConfidence: z.enum(["deterministic", "high", "heuristic"]),
  })
  .strict();

export type DestinationCandidate = z.infer<typeof destinationCandidateSchema>;

// ── Requirements (derived from the Blueprint, host-owned) ───────

export const mappingRequirementKindSchema = z.enum([
  "component-definition",
  "component-instance",
  "region",
  "screen-reachability",
  "asset",
  "foundation",
]);

export const mappingRequirementSchema = z
  .object({
    /** Host-minted, stable and derived from Blueprint ids. */
    id: z.string().min(1).max(200),
    kind: mappingRequirementKindSchema,
    label: z.string().min(1).max(200),
    /** The Blueprint entity this requirement came from. */
    blueprintRef: z.string().min(1).max(200),
    /** Instance requirements name their component-definition requirement. */
    parentRequirementId: z.string().min(1).max(200).optional(),
    /** Facts a candidate must satisfy — slots, states, variants, copy. */
    demands: z.array(z.string().min(1).max(240)).max(24).default([]),
    required: z.boolean().default(true),
  })
  .strict();

export type MappingRequirement = z.infer<typeof mappingRequirementSchema>;

// ── Decisions (the only thing a patch may author) ───────────────

export const mappingActionSchema = z.enum(["reuse", "extend", "create"]);

export type MappingAction = z.infer<typeof mappingActionSchema>;

export const mappingCompatibilitySchema = z
  .object({
    structure: z.enum(["compatible", "partial", "incompatible", "unknown"]).default("unknown"),
    slots: z.enum(["compatible", "partial", "incompatible", "unknown"]).default("unknown"),
    states: z.enum(["compatible", "partial", "incompatible", "unknown"]).default("unknown"),
    visual: z.enum(["compatible", "partial", "incompatible", "unknown"]).default("unknown"),
    interaction: z.enum(["compatible", "partial", "incompatible", "unknown"]).default("unknown"),
  })
  .strict();

export type MappingCompatibility = z.infer<typeof mappingCompatibilitySchema>;

export const componentMappingSchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    blueprintComponentId: z.string().min(1).max(200),
    action: mappingActionSchema,
    /** Set for reuse/extend: the selected host-offered candidate. */
    candidateId: z.string().min(1).max(200).optional(),
    projectTarget: z
      .object({
        name: z.string().min(1).max(200),
        path: z.string().min(1).max(400),
        exportName: z.string().min(1).max(160).optional(),
      })
      .strict()
      .optional(),
    /** For `create`: the host-offered directory the new component belongs in. */
    plannedDirectoryId: z.string().min(1).max(200).optional(),
    plannedPath: z.string().min(1).max(400).optional(),
    compatibility: mappingCompatibilitySchema,
    /** Bounded, human-readable adaptations. Never code. */
    requiredAdaptations: z.array(z.string().min(1).max(240)).max(12).default([]),
    reason: z.string().min(1).max(400),
    confidence: z.enum(["high", "medium", "low"]),
    /** Requirement ids and candidate ids this decision rests on. */
    evidence: z.array(z.string().min(1).max(200)).max(16).default([]),
  })
  .strict();

export type ComponentMapping = z.infer<typeof componentMappingSchema>;

export const screenMappingSchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    destination: z
      .object({
        action: z.enum(["use_existing", "create_route", "create_page", "integrate_existing_root"]),
        candidateId: z.string().min(1).max(200),
        path: z.string().min(1).max(400),
        route: z.string().min(1).max(200).optional(),
      })
      .strict(),
    /** The file that makes the screen reachable, when one is needed. */
    compositionRootCandidateId: z.string().min(1).max(200).optional(),
    compositionRootPath: z.string().min(1).max(400).optional(),
    reason: z.string().min(1).max(400),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export type ScreenMapping = z.infer<typeof screenMappingSchema>;

export const styleMappingSchema = z
  .object({
    /** The Blueprint foundation value, verbatim. */
    designValue: z.string().min(1).max(200),
    category: z.string().min(1).max(40),
    strategy: z.enum(["reuse_token", "reuse_style", "raw_design_value", "extend_token"]),
    /** Host-offered project token reference, when one was selected. */
    projectTokenReference: z.string().min(1).max(200).optional(),
    reason: z.string().min(1).max(240),
    /** Set when a token was chosen over the exact design value. */
    equivalence: z.enum(["exact", "within-tolerance"]).optional(),
  })
  .strict();

export type StyleMapping = z.infer<typeof styleMappingSchema>;

export const assetMappingSchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    blueprintAssetId: z.string().min(1).max(200),
    strategy: z.enum([
      "reuse_project_asset",
      "reuse_project_icon",
      "use_design_asset",
      "create_local_asset",
      "runtime_reference",
      "unresolved",
    ]),
    projectAssetPath: z.string().min(1).max(400).optional(),
    reason: z.string().min(1).max(240),
  })
  .strict();

export type AssetMapping = z.infer<typeof assetMappingSchema>;

/**
 * How the screen is put together, in Blueprint order.
 *
 * The Builder should never have to infer page architecture from a list of
 * isolated file operations — that is how a component gets created and never
 * mounted.
 */
export const compositionNodeSchema = z
  .object({
    /** Blueprint region or element id. */
    blueprintRef: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    order: z.number().int().nonnegative(),
    /** The component mapping that realizes this node, when one applies. */
    componentRequirementId: z.string().min(1).max(200).optional(),
    childRefs: z.array(z.string().min(1).max(200)).max(64).default([]),
  })
  .strict();

export const compositionMappingSchema = z
  .object({
    rootLabel: z.string().min(1).max(200),
    nodes: z.array(compositionNodeSchema).max(128).default([]),
  })
  .strict();

// ── Coverage ────────────────────────────────────────────────────

export const coverageStatusSchema = z.enum([
  "mapped",
  "intentionally_not_implemented",
  "unsupported",
  "unresolved",
]);

export const coverageEntrySchema = z
  .object({
    requirementId: z.string().min(1).max(200),
    kind: mappingRequirementKindSchema,
    label: z.string().min(1).max(200),
    status: coverageStatusSchema,
    note: z.string().min(1).max(240).optional(),
  })
  .strict();

export type CoverageEntry = z.infer<typeof coverageEntrySchema>;

export type CoverageStatus = z.infer<typeof coverageStatusSchema>;

export type CompositionNode = z.infer<typeof compositionNodeSchema>;

export type CompositionMapping = z.infer<typeof compositionMappingSchema>;

/**
 * Coverage is first-class and never silent.
 *
 * A truncated requirement set cannot report `complete`: `truncated` forces
 * the summary to say so, because "everything is covered" computed from a
 * list that quietly dropped entries is the failure mode the legacy coverage
 * check shipped with.
 */
export const mappingCoverageSchema = z
  .object({
    totalRequired: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
    truncated: z.boolean().default(false),
    bound: mappingBoundSchema.optional(),
    entries: z.array(coverageEntrySchema).max(400).default([]),
    status: z.enum(["complete", "incomplete", "truncated"]),
  })
  .strict();

export type MappingCoverage = z.infer<typeof mappingCoverageSchema>;

export const mappingUncertaintySchema = z
  .object({
    code: z.string().min(1).max(120),
    description: z.string().min(1).max(400),
    requirementIds: z.array(z.string().min(1).max(200)).max(32).default([]),
    requiresUserInput: z.boolean().default(false),
  })
  .strict();

export type MappingUncertainty = z.infer<typeof mappingUncertaintySchema>;

export const mappingStatusSchema = z.enum(["draft", "complete", "partial", "unavailable"]);

export type MappingStatus = z.infer<typeof mappingStatusSchema>;

// ── The map (and its deterministic draft) ───────────────────────

/**
 * The host-owned skeleton: every requirement, every candidate, every binding,
 * with no decisions in it. The AI patches decisions into this; it can never
 * add or remove a requirement, and it can never introduce a project
 * reference the host did not offer.
 */
export const implementationMapDraftSchema = z
  .object({
    schemaVersion: z.literal(IMPLEMENTATION_MAP_SCHEMA_VERSION),
    binding: implementationMapBindingSchema,
    requirements: z.array(mappingRequirementSchema).max(400).default([]),
    /** Candidate sets keyed by requirement id. */
    candidates: z
      .array(
        z
          .object({
            requirementId: z.string().min(1).max(200),
            candidates: z.array(mappingCandidateSchema).max(16).default([]),
            bound: mappingBoundSchema.optional(),
          })
          .strict(),
      )
      .max(400)
      .default([]),
    destinationCandidates: z.array(destinationCandidateSchema).max(32).default([]),
    /** Directories a `create` decision may plan a new component into. */
    plannedDirectories: z
      .array(z.object({ id: z.string().min(1).max(200), path: z.string().min(1).max(400) }).strict())
      .max(16)
      .default([]),
    /** Project tokens a style decision may reference. */
    projectTokens: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            reference: z.string().min(1).max(200),
            value: z.string().max(400),
            category: z.string().min(1).max(40).optional(),
          })
          .strict(),
      )
      .max(200)
      .default([]),
    /** Project assets an asset decision may reference. */
    projectAssets: z
      .array(z.object({ id: z.string().min(1).max(200), path: z.string().min(1).max(400) }).strict())
      .max(64)
      .default([]),
    bounds: z.array(mappingBoundSchema).max(24).default([]),
    provenance: z
      .object({
        compilerVersion: z.string().min(1).max(40),
      })
      .strict(),
  })
  .strict();

export type ImplementationMapDraft = z.infer<typeof implementationMapDraftSchema>;

export const implementationMapSchema = implementationMapDraftSchema
  .extend({
    status: mappingStatusSchema,
    screen: screenMappingSchema.optional(),
    components: z.array(componentMappingSchema).max(400).default([]),
    styles: z.array(styleMappingSchema).max(200).default([]),
    assets: z.array(assetMappingSchema).max(64).default([]),
    composition: compositionMappingSchema.optional(),
    coverage: mappingCoverageSchema,
    uncertainties: z.array(mappingUncertaintySchema).max(64).default([]),
    mapper: z
      .object({
        partitionCount: z.number().int().nonnegative().default(0),
        patchCount: z.number().int().nonnegative().default(0),
        agentId: z.string().min(1).max(120).optional(),
        agentVersion: z.string().min(1).max(40).optional(),
        modelProfileId: z.string().min(1).max(120).optional(),
        model: z.string().min(1).max(160).optional(),
        failures: z
          .array(z.object({ partitionId: z.string().min(1).max(160), code: z.string().min(1).max(120) }).strict())
          .max(32)
          .default([]),
      })
      .strict(),
  })
  .strict();

export type ImplementationMap = z.infer<typeof implementationMapSchema>;
