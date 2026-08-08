// packages/sdk/src/design-engineer-contracts.ts
import { z } from "zod";

/**
 * Typed artifact contracts exchanged between the Design Engineer's
 * specialized agents.
 *
 * Domain-specific, unlike the rest of this package, but living here rather
 * than in a dedicated module is a deliberate exception: these schemas are the
 * validated boundary a *generic* invocation port (`agent-invocation.ts`)
 * needs on both sides, and a Figma-specific package the engine or the
 * invocation runtime would have to depend on to type-check would reopen the
 * exact layering `architecture.test.ts` files across this repo exist to keep
 * closed. Nothing here reaches a network, a filesystem or a Figma API — it
 * only describes shapes.
 *
 * Every contract carries its own `schemaVersion`, bumped only when the shape
 * itself changes — not when a value inside it changes. Bumping it invalidates
 * every reuse decision keyed on this contract at once, since a workflow node
 * that reads a payload against a schema it no longer matches must never be
 * treated as reusable.
 */
export const DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION = "1";

/**
 * Bumped independently of `DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION` above —
 * the Figma source snapshot and the design specification are the two
 * contracts Stage 3 actually evolved; the project-context, implementation,
 * validation and revision contracts are untouched, and forcing every
 * contract's stamped version to move together would invalidate reuse for
 * artifacts that never changed shape.
 */
export const FIGMA_SOURCE_SNAPSHOT_SCHEMA_VERSION = "2";
export const DESIGN_SPECIFICATION_SCHEMA_VERSION = "2";

// ── A. Figma source snapshot ────────────────────────────────────

/**
 * A geometric bounding box, in the units the source reports them.
 */
const boundingBoxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict();

/**
 * One node's normalized, implementation-relevant facts.
 *
 * Every field beyond `id`/`name`/`type` is optional: a real MCP server may
 * not expose a given fact for a given node (a text-only node has no
 * `layoutMode`; a locked/hidden node may report no fills at all), and this
 * schema must represent "not reported" as absence, never as a fabricated
 * zero or empty value. `properties` remains as an escape hatch for
 * anything a server returns that this schema does not yet model by
 * name — forward-compatible without becoming encyclopedic, and the same
 * field Stage 2's fixture nodes already populated, so it stays back-compatible
 * with every node object Stage 2 ever produced.
 */
export const figmaNodeSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    parentId: z.string().min(1).optional(),
    childIds: z.array(z.string().min(1)).default([]),
    visible: z.boolean().optional(),
    absoluteBoundingBox: boundingBoxSchema.optional(),
    relativeBoundingBox: boundingBoxSchema.optional(),
    layoutMode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional(),
    itemSpacing: z.number().optional(),
    padding: z
      .object({
        top: z.number(),
        right: z.number(),
        bottom: z.number(),
        left: z.number(),
      })
      .strict()
      .optional(),
    primaryAxisAlignItems: z.string().optional(),
    counterAxisAlignItems: z.string().optional(),
    sizingHorizontal: z.string().optional(),
    sizingVertical: z.string().optional(),
    constraints: z
      .object({ horizontal: z.string(), vertical: z.string() })
      .strict()
      .optional(),
    cornerRadius: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fills: z.array(z.record(z.unknown())).default([]),
    strokes: z.array(z.record(z.unknown())).default([]),
    effects: z.array(z.record(z.unknown())).default([]),
    characters: z.string().optional(),
    textAlignHorizontal: z.string().optional(),
    /** Set when this node is a component instance. */
    componentId: z.string().min(1).optional(),
    variantProperties: z.record(z.string()).optional(),
    /** Figma variable ids bound to specific properties of this node, by property name. */
    boundVariables: z.record(z.unknown()).optional(),
    exportSettings: z.array(z.record(z.unknown())).default([]),
    /** Prototype/interaction data, carried opaquely — see `warnings` for what could not be interpreted. */
    interactions: z.array(z.record(z.unknown())).default([]),
    /** Anything this schema does not yet model by name. Never fabricated, only ever forwarded. */
    properties: z.record(z.unknown()).default({}),
  })
  .strict();

export type FigmaNodeSnapshot = z.infer<typeof figmaNodeSnapshotSchema>;

export const figmaVariableSnapshotSchema = z
  .object({
    name: z.string().min(1),
    value: z.unknown(),
    type: z.string().optional(),
    collection: z.string().optional(),
  })
  .strict();

export type FigmaVariableSnapshot = z.infer<typeof figmaVariableSnapshotSchema>;

export const figmaStyleSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** e.g. `FILL`, `TEXT`, `EFFECT`, `GRID` — carried as the server reports it, not re-enumerated here. */
    styleType: z.string().min(1),
    value: z.record(z.unknown()).optional(),
  })
  .strict();

export type FigmaStyleSnapshot = z.infer<typeof figmaStyleSnapshotSchema>;

export const figmaComponentSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    key: z.string().min(1).optional(),
    description: z.string().optional(),
    variantProperties: z.record(z.string()).optional(),
  })
  .strict();

export type FigmaComponentSnapshot = z.infer<typeof figmaComponentSnapshotSchema>;

export const figmaAssetSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    reference: z.string().min(1).optional(),
    format: z.enum(["png", "jpeg", "webp", "svg"]).optional(),
  })
  .strict();

export type FigmaAssetSnapshot = z.infer<typeof figmaAssetSnapshotSchema>;

/**
 * One captured reference screenshot, stored as its own artifact.
 *
 * `artifactId` is the *only* place the actual image bytes live — this
 * record never carries pixel data itself, which is what keeps it safe to
 * show in a terminal, a trace, or a saved run record. See
 * `screenshot-artifact.ts` in `@designflow/capability-figma-mcp` for how the
 * artifact itself is validated and stored.
 */
export const figmaScreenshotSnapshotSchema = z
  .object({
    nodeId: z.string().min(1),
    artifactId: z.string().min(1),
    /** Optional source-native viewport identity supplied by an upstream capture. */
    viewportId: z.string().min(1).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    format: z.enum(["png", "jpeg", "webp"]),
  })
  .strict();

export type FigmaScreenshotSnapshot = z.infer<typeof figmaScreenshotSnapshotSchema>;

/** A safe, honest record of something the snapshot builder could not do — never silently skipped. */
export const figmaSnapshotWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    nodeId: z.string().min(1).optional(),
  })
  .strict();

export type FigmaSnapshotWarning = z.infer<typeof figmaSnapshotWarningSchema>;

/** Safe, typed identity of the Figma source behind a derived artifact. */
export const figmaSourceProvenanceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("placeholder") }).strict(),
  z.object({
    mode: z.literal("rest"),
    transport: z.literal("rest"),
    serverIdentity: z.string().min(1),
    requestedFileKey: z.string().min(1),
    requestedNodeId: z.string().min(1).optional(),
    resolvedNodeId: z.string().min(1).optional(),
  }).strict(),
  z.object({
    mode: z.literal("mcp-stdio"),
    transport: z.literal("stdio"),
    serverIdentity: z.string().min(1),
    requestedFileKey: z.string().min(1),
    requestedNodeId: z.string().min(1).optional(),
    resolvedNodeId: z.string().min(1).optional(),
  }).strict(),
  z.object({
    mode: z.literal("mcp-desktop"),
    transport: z.literal("http"),
    serverIdentity: z.literal("figma-desktop"),
    requestedFileKey: z.string().min(1),
    requestedNodeId: z.string().min(1).optional(),
    resolvedNodeId: z.string().min(1),
  }).strict(),
]);

export type FigmaSourceProvenance = z.infer<typeof figmaSourceProvenanceSchema>;

/**
 * Normalized, implementation-relevant Figma source data.
 *
 * Stage 2 shipped this as a pure fixture (`prepare-figma-source-fixture`
 * built one deterministically from workflow input, nothing was fetched).
 * Stage 3 keeps the same logical id and the same `source.designFile` /
 * `source.frames` / `nodes[].properties` fields Stage 2 already populated —
 * a Stage 2 fixture snapshot still parses against this schema — and adds
 * the fields a real MCP-backed retrieval needs: normalized source identity,
 * per-node geometry and style facts, variables/styles/components/assets,
 * screenshot references, a `capabilities` block recording what the
 * connected server could actually provide, and `warnings` for whatever it
 * could not. See `@designflow/capability-figma-mcp` for the deterministic
 * retrieval path that builds one from a real server; nothing in this file
 * fetches anything itself.
 */
export const figmaSourceSnapshotSchema = z
  .object({
    schemaVersion: z.string().min(1).default(FIGMA_SOURCE_SNAPSHOT_SCHEMA_VERSION),
    source: z
      .object({
        /** Retained from Stage 2 for back-compatibility; the worker-facing free-text field. */
        designFile: z.string().min(1),
        originalInput: z.string().min(1).optional(),
        normalizedUrl: z.string().min(1).optional(),
        fileKey: z.string().min(1).optional(),
        nodeIds: z.array(z.string().min(1)).default([]),
        /** Retained from Stage 2 for back-compatibility; frame names/paths as requested. */
        frames: z.array(z.string().min(1)).default([]),
        resolvedFrames: z
          .array(
            z
              .object({
                id: z.string().min(1),
                name: z.string().min(1),
                path: z.array(z.string().min(1)).default([]),
              })
              .strict(),
          )
          .default([]),
        documentName: z.string().optional(),
        /** Figma's own document version identity, when the server reports one — preferred over a timestamp for reuse. */
        documentVersion: z.string().optional(),
        lastModified: z.string().optional(),
      })
      .strict(),
    capabilities: z
      .object({
        variablesAvailable: z.boolean().default(false),
        stylesAvailable: z.boolean().default(false),
        componentsAvailable: z.boolean().default(false),
        assetsAvailable: z.boolean().default(false),
        screenshotsAvailable: z.boolean().default(false),
      })
      .strict()
      .default({}),
    nodes: z.array(figmaNodeSnapshotSchema).default([]),
    variables: z.array(figmaVariableSnapshotSchema).default([]),
    styles: z.array(figmaStyleSnapshotSchema).default([]),
    components: z.array(figmaComponentSnapshotSchema).default([]),
    assets: z.array(figmaAssetSnapshotSchema).default([]),
    screenshots: z.array(figmaScreenshotSnapshotSchema).default([]),
    warnings: z.array(figmaSnapshotWarningSchema).default([]),
    provenance: z
      .object({
        /** e.g. a server name/version string. Never a credential, a header, or an endpoint URL. */
        mcpServerIdentity: z.string().optional(),
        retrievedAt: z.string().optional(),
        toolVersions: z.record(z.string()).optional(),
      })
      .strict()
      .default({}),
    /** Source-mode identity is separate from transport provenance and is safe to inspect. */
    sourceProvenance: figmaSourceProvenanceSchema.optional(),
    /** Retained from Stage 2; superseded by `screenshots` above but harmless to keep reading. */
    screenshotArtifactId: z.string().min(1).optional(),
  })
  .strict();

export type FigmaSourceSnapshot = z.infer<typeof figmaSourceSnapshotSchema>;

// ── B. Design specification ─────────────────────────────────────

/**
 * One thing the Figma Specification Agent could not resolve from the
 * source snapshot alone.
 *
 * Structured rather than a plain string (Stage 2's shape) so a caller can
 * act on it — filter to what actually needs a person's answer
 * (`requiresUserInput`), show which nodes it concerns, and, when the agent
 * has one, ask the exact question rather than a generic "please clarify."
 */
export const designSpecificationAmbiguitySchema = z
  .object({
    code: z.string().min(1),
    description: z.string().min(1),
    affectedNodeIds: z.array(z.string().min(1)).default([]),
    requiresUserInput: z.boolean().default(false),
    suggestedQuestion: z.string().min(1).optional(),
  })
  .strict();

export type DesignSpecificationAmbiguity = z.infer<
  typeof designSpecificationAmbiguitySchema
>;

/** One proposed, semantic component the agent identified from the source structure. */
export const designSpecificationComponentSchema = z
  .object({
    name: z.string().min(1),
    role: z.string().min(1),
    /** The source snapshot's node ids this component was derived from — must exist in that snapshot. */
    sourceNodeIds: z.array(z.string().min(1)).default([]),
    variants: z.array(z.string().min(1)).default([]),
    properties: z.record(z.unknown()).optional(),
    reusableAssessment: z.enum(["reusable", "one-off", "uncertain"]).optional(),
    requiredAssets: z.array(z.string().min(1)).default([]),
    accessibilityRole: z.string().optional(),
    implementationNotes: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type DesignSpecificationComponent = z.infer<
  typeof designSpecificationComponentSchema
>;

/** The Figma Specification Agent's output. */
export const designSpecificationSchema = z
  .object({
    schemaVersion: z.string().min(1).default(DESIGN_SPECIFICATION_SCHEMA_VERSION),
    sourceIdentity: z
      .object({
        designFile: z.string().min(1),
        fileKey: z.string().min(1).optional(),
        documentVersion: z.string().optional(),
      })
      .strict(),
    /** The source snapshot artifact this specification was derived from — for lineage and inspection. */
    sourceSnapshotArtifactId: z.string().min(1).optional(),
    sourceProvenanceDigest: z.string().min(1).optional(),
    /** Screenshot artifact ids the source snapshot carried, copied forward for easy inspection. */
    screenshotArtifactIds: z.array(z.string().min(1)).default([]),
    frames: z.array(z.string().min(1)),
    hierarchy: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          parentId: z.string().min(1).optional(),
        })
        .strict(),
    ),
    designTokens: z
      .object({
        colors: z.array(z.string().min(1)),
        spacing: z.array(z.string().min(1)),
        typography: z.array(z.string().min(1)),
        radii: z.array(z.string().min(1)).default([]),
        borders: z.array(z.string().min(1)).default([]),
        shadows: z.array(z.string().min(1)).default([]),
        /** Token names bound to a real Figma variable/style, vs. only a locally observed value. */
        referencedVariableNames: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    components: z.array(designSpecificationComponentSchema),
    layoutBehavior: z.array(z.string().min(1)),
    responsiveAssumptions: z.array(z.string().min(1)),
    assets: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()),
    /** Visible text, labels, and dynamic/placeholder-content assumptions, as plain descriptive lines. */
    content: z.array(z.string().min(1)).default([]),
    interactions: z.array(z.string().min(1)),
    /** Interaction/prototype states represented in the source (hover, pressed, focus, disabled, ...). */
    states: z.array(z.string().min(1)).default([]),
    accessibilityNotes: z.array(z.string().min(1)),
    /** Things the agent could not resolve from the source alone. */
    ambiguities: z.array(designSpecificationAmbiguitySchema),
    /** The Figma Specification Agent's own manifest version, at time of production. */
    agentVersion: z.string().min(1),
  })
  .strict();

export type DesignSpecification = z.infer<typeof designSpecificationSchema>;

// ── C. Project implementation context ───────────────────────────

/**
 * What the Implementation Agent is told about the target project.
 *
 * `projectRootIdentity` is an opaque, stable id — never a filesystem path.
 * Validating this object performs no filesystem access; the identity is
 * resolved to an actual path only by whichever future stage writes real
 * files, and that stage is explicitly out of scope here.
 */
export const projectImplementationContextSchema = z
  .object({
    schemaVersion: z.string().min(1).default(DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION),
    projectId: z.string().min(1).optional(),
    projectRootIdentity: z.string().min(1),
    framework: z.string().min(1),
    sourceRoot: z.string().min(1),
    stylingStrategy: z.string().min(1),
    existingComponentReferences: z.array(z.string().min(1)).default([]),
    designSystemReferences: z.array(z.string().min(1)).default([]),
    testCommand: z.string().min(1).optional(),
    buildCommand: z.string().min(1).optional(),
    /** A content fingerprint of the facts above, so reuse can key on it directly. */
    contextFingerprint: z.string().min(1),
  })
  .strict();

export type ProjectImplementationContext = z.infer<
  typeof projectImplementationContextSchema
>;

// ── D. Implementation plan ──────────────────────────────────────

export const implementationPlanSchema = z
  .object({
    schemaVersion: z.string().min(1).default(DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION),
    targetComponents: z.array(z.string().min(1)),
    reusedProjectComponents: z.array(z.string().min(1)),
    proposedFiles: z.array(
      z.object({ path: z.string().min(1), action: z.enum(["create", "modify"]) }).strict(),
    ),
    assumptions: z.array(z.string().min(1)),
    unresolvedQuestions: z.array(z.string().min(1)),
    dependencyRequirements: z.array(z.string().min(1)),
    agentVersion: z.string().min(1),
  })
  .strict();

export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;

// ── E. Generated implementation ─────────────────────────────────

/**
 * The Implementation Agent's output — structured, pseudo file proposals.
 *
 * `content` is a string the agent produced, stored as a DesignFlow artifact
 * exactly like Stage 1's `generate-code` output. Nothing here is written to
 * the project's own filesystem; that remains a later stage's work.
 */
/** Hard bound on host-derived required implementation coverage targets. */
export const MAX_IMPLEMENTATION_COVERAGE_TARGETS = 8 as const;

/**
 * A model claim about how its proposal satisfies one host-required design
 * target: either files inside the exact proposal (`proposed_change`) or
 * trusted already-existing mapped implementation (`existing_reuse`). The
 * host, never the model, defines the required targets and the trusted
 * reuse paths.
 */
export const implementationCoverageClaimSchema = z
  .object({
    targetId: z.string().min(1),
    mode: z.enum(["proposed_change", "existing_reuse"]),
    paths: z.array(z.string().min(1)).min(1).max(8),
    supportingPaths: z.array(z.string().min(1)).max(16).default([]),
  })
  .strict();
export type ImplementationCoverageClaim = z.infer<typeof implementationCoverageClaimSchema>;

/** Host-derived required design surface for an implementation proposal. */
export const implementationCoveragePlanV1Schema = z
  .object({
    schemaVersion: z.literal("1"),
    targetFrame: z.object({ nodeId: z.string().min(1), name: z.string().min(1) }).strict(),
    requiredTargets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.enum(["root_frame", "component"]),
            requirement: z.literal("required"),
            source: z.string().min(1),
            name: z.string().min(1).optional(),
            mappedProjectPaths: z.array(z.string().min(1)).max(8).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_IMPLEMENTATION_COVERAGE_TARGETS),
    trustedReusePaths: z.array(z.string().min(1)).max(128).default([]),
  })
  .strict();
export type ImplementationCoveragePlanV1 = z.infer<typeof implementationCoveragePlanV1Schema>;

export const generatedImplementationSchema = z
  .object({
    sourceProvenanceDigest: z.string().min(1).optional(),
    files: z.array(
      z
        .object({
          path: z.string().min(1),
          action: z.enum(["create", "modify"]),
          content: z.string(),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    assumptions: z.array(z.string().min(1)),
    unresolvedItems: z.array(z.string().min(1)),
    implementationVersion: z.string().min(1),
    /** Optional for backward compatibility: old artifacts carry no claims and are never reinterpreted as covered. */
    coverageClaims: z.array(implementationCoverageClaimSchema).max(16).default([]),
  })
  .strict();

export type GeneratedImplementation = z.infer<typeof generatedImplementationSchema>;

// ── F. Visual validation report ─────────────────────────────────

export const visualValidationDiscrepancySchema = z
  .object({
    category: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]),
    expected: z.string().min(1),
    actual: z.string().min(1),
    recommendation: z.string().min(1),
  })
  .strict();

export type VisualValidationDiscrepancy = z.infer<
  typeof visualValidationDiscrepancySchema
>;

/** The Visual Validation Agent's output. */
export const visualValidationReportSchema = z
  .object({
    schemaVersion: z.string().min(1).default(DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION),
    overallScore: z.number().min(0).max(1),
    threshold: z.number().min(0).max(1),
    passed: z.boolean(),
    discrepancies: z.array(visualValidationDiscrepancySchema),
    /** Screenshot artifact ids compared, when any were available. */
    screenshotReferences: z.array(z.string().min(1)).default([]),
    validationAttempt: z.number().int().positive(),
    agentVersion: z.string().min(1),
  })
  .strict();

export type VisualValidationReport = z.infer<typeof visualValidationReportSchema>;

// ── G. Revision request ─────────────────────────────────────────

/**
 * What a failed validation would hand back to the Implementation Agent, in a
 * future stage's feedback loop.
 *
 * Defined now so the contract exists and can be reviewed, but nothing in
 * Stage 2 produces or consumes one — the workflow this stage ships is a
 * straight line with no revision edge. Wiring this in is explicitly the
 * feedback loop's job, out of scope here.
 */
export const revisionRequestSchema = z
  .object({
    schemaVersion: z.string().min(1).default(DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION),
    sourceValidationReportRef: z.string().min(1),
    prioritizedCorrections: z.array(
      z
        .object({
          description: z.string().min(1),
          required: z.boolean(),
          affected: z.array(z.string().min(1)),
        })
        .strict(),
    ),
    attempt: z.number().int().positive(),
    reason: z.string().min(1),
    agentVersion: z.string().min(1),
  })
  .strict();

export type RevisionRequest = z.infer<typeof revisionRequestSchema>;
