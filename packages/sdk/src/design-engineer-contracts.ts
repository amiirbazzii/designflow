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

// ── A. Figma source snapshot ────────────────────────────────────

/**
 * A Stage 2 *fixture-level* stand-in for a real Figma MCP response.
 *
 * Nothing here is fetched from Figma — `prepare-figma-source-fixture`
 * constructs one deterministically from workflow input. The shape is
 * intentionally close to what a real MCP response is expected to carry, so a
 * later stage can replace the fixture with a real fetch without touching the
 * Figma Specification Agent's input contract.
 */
export const figmaSourceSnapshotSchema = z
  .object({
    schemaVersion: z.string().min(1).default(DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION),
    source: z
      .object({
        designFile: z.string().min(1),
        fileKey: z.string().min(1).optional(),
        nodeIds: z.array(z.string().min(1)).default([]),
        frames: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            type: z.string().min(1),
            parentId: z.string().min(1).optional(),
            properties: z.record(z.unknown()).default({}),
          })
          .strict(),
      )
      .default([]),
    variables: z
      .array(z.object({ name: z.string().min(1), value: z.unknown() }).strict())
      .default([]),
    assets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            type: z.string().min(1),
            reference: z.string().min(1).optional(),
          })
          .strict(),
      )
      .default([]),
    /** A screenshot artifact this snapshot's caller already stored, if any. */
    screenshotArtifactId: z.string().min(1).optional(),
  })
  .strict();

export type FigmaSourceSnapshot = z.infer<typeof figmaSourceSnapshotSchema>;

// ── B. Design specification ─────────────────────────────────────

/** The Figma Specification Agent's output. */
export const designSpecificationSchema = z
  .object({
    schemaVersion: z.string().min(1).default(DESIGN_ENGINEER_CONTRACT_SCHEMA_VERSION),
    sourceIdentity: z
      .object({
        designFile: z.string().min(1),
        fileKey: z.string().min(1).optional(),
      })
      .strict(),
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
      })
      .strict(),
    components: z.array(
      z.object({ name: z.string().min(1), role: z.string().min(1) }).strict(),
    ),
    layoutBehavior: z.array(z.string().min(1)),
    responsiveAssumptions: z.array(z.string().min(1)),
    assets: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()),
    interactions: z.array(z.string().min(1)),
    accessibilityNotes: z.array(z.string().min(1)),
    /** Things the agent could not resolve from the source alone. */
    ambiguities: z.array(z.string().min(1)),
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
export const generatedImplementationSchema = z
  .object({
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
