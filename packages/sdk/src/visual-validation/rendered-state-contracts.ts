// packages/sdk/src/visual-validation/rendered-state-contracts.ts
import { z } from "zod";
import { visualFindingV1Schema, visualFindingSeverityV1Schema } from "./visual-validation-contracts";

/**
 * Pre-approval visual evaluation (Agent Architecture V2, phase V2-5).
 *
 *   validated proposal → isolated workspace → build → preview → capture
 *                                 ↓
 *                           RenderedState
 *                                 ↓
 *        deterministic deltas (Blueprint expectations vs measurements)
 *                                 ↓
 *                    Visual Critic interpretation
 *                                 ↓
 *                         VisualDeltaReport
 *
 * The division this contract enforces: a browser can measure a height, a
 * color and a bounding box, so nothing here asks a model what those are. The
 * model's contribution is which differences matter and why — added *beside*
 * the measurements, never over them.
 *
 * Rendering happens against an isolated copy of the project. Nothing in this
 * phase writes to the user's registered project.
 */

export const RENDERED_STATE_SCHEMA_VERSION = "1";
export const VISUAL_DELTA_REPORT_SCHEMA_VERSION = "1";

export const RENDERED_STATE_ARTIFACT_ID = "rendered-state";
export const RENDERED_STATE_ARTIFACT_TYPE = "implementation.rendered-state";
export const VISUAL_DELTA_REPORT_ARTIFACT_ID = "visual-delta-report";
export const VISUAL_DELTA_REPORT_ARTIFACT_TYPE = "implementation.visual-delta-report";

// ── RenderedState ───────────────────────────────────────────────

/**
 * What was rendered, and from exactly which plan and proposal.
 *
 * `proposalHash` is the identity that makes "rendered = validated" checkable:
 * the bytes that were built are the bytes the Builder's gates passed, and
 * nothing regenerates code between the two.
 */
export const renderedStateBindingSchema = z
  .object({
    blueprintArtifactId: z.string().min(1).max(200).optional(),
    implementationMapArtifactId: z.string().min(1).max(200).optional(),
    proposalArtifactId: z.string().min(1).max(200).optional(),
    /** sha256 of the exact proposal that was materialized. */
    proposalHash: z.string().min(1).max(200),
    projectFingerprint: z.string().min(1).max(200).optional(),
  })
  .strict();

export const renderedViewportSchema = z
  .object({
    id: z.string().min(1).max(80),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
    captureStatus: z.enum(["captured", "failed", "skipped"]),
    /** Content-addressed screenshot artifact; never inline image bytes. */
    screenshotArtifactId: z.string().min(1).max(200).optional(),
    screenshotContentHash: z.string().min(1).max(200).optional(),
    domEvidenceStatus: z.enum(["captured", "unavailable"]),
    /** Bounded runtime facts observed while capturing. */
    consoleErrorCount: z.number().int().nonnegative().default(0),
    runtimeErrorCount: z.number().int().nonnegative().default(0),
    warnings: z.array(z.string().min(1).max(300)).max(12).default([]),
  })
  .strict();

export type RenderedViewport = z.infer<typeof renderedViewportSchema>;

/**
 * One measured element as the browser reported it.
 *
 * `blueprintRef` is the correspondence the host established deterministically
 * — from the Implementation Map and the element's own exact content — not a
 * model's guess about which div is the header.
 */
export const renderedElementEvidenceSchema = z
  .object({
    viewportId: z.string().min(1).max(80),
    selector: z.string().min(1).max(400),
    /** Blueprint element/component id, when correspondence was established. */
    blueprintRef: z.string().min(1).max(200).optional(),
    text: z.string().max(2_000).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    display: z.string().max(60).optional(),
    visibility: z.string().max(60).optional(),
    color: z.string().max(60).optional(),
    backgroundColor: z.string().max(60).optional(),
    borderColor: z.string().max(60).optional(),
    borderRadius: z.string().max(60).optional(),
    fontFamily: z.string().max(160).optional(),
    fontSize: z.string().max(60).optional(),
    fontWeight: z.string().max(60).optional(),
    padding: z.string().max(120).optional(),
    margin: z.string().max(120).optional(),
    opacity: z.string().max(40).optional(),
  })
  .strict();

export type RenderedElementEvidence = z.infer<typeof renderedElementEvidenceSchema>;

export const renderedStateStatusSchema = z.enum([
  "rendered",
  "render_failed",
  "browser_unavailable",
  "project_changed_before_render",
  "cancelled",
]);

export type RenderedStateStatus = z.infer<typeof renderedStateStatusSchema>;

export const renderedStateSchema = z
  .object({
    schemaVersion: z.literal(RENDERED_STATE_SCHEMA_VERSION),
    status: renderedStateStatusSchema,
    binding: renderedStateBindingSchema,
    viewports: z.array(renderedViewportSchema).max(8).default([]),
    elements: z.array(renderedElementEvidenceSchema).max(256).default([]),
    /** Deterministic pixel comparison, when a reference was available. */
    pixelComparisons: z
      .array(
        z
          .object({
            viewportId: z.string().min(1).max(80),
            algorithmVersion: z.string().min(1).max(80),
            mismatchRatio: z.number().min(0).max(1),
            dimensionCompatible: z.boolean(),
            referenceEvidenceId: z.string().min(1).max(200).optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
    runtime: z
      .object({
        buildStatus: z.enum(["passed", "failed", "unavailable"]),
        previewStatus: z.enum(["ready", "failed", "unavailable"]),
        /** Never a live URL: a stable identity, not an address to reuse. */
        previewIdentity: z.string().min(1).max(120).optional(),
        buildMs: z.number().nonnegative().optional(),
        previewStartMs: z.number().nonnegative().optional(),
        captureMs: z.number().nonnegative().optional(),
        diagnostics: z.array(z.string().min(1).max(400)).max(12).default([]),
      })
      .strict(),
    provenance: z
      .object({
        rendererVersion: z.string().min(1).max(40),
        workspaceIsolated: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type RenderedState = z.infer<typeof renderedStateSchema>;

// ── Deterministic expectations ──────────────────────────────────

export const visualExpectationKindSchema = z.enum([
  "geometry",
  "typography",
  "surface",
  "content",
  "structure",
  "composition",
]);

/**
 * One checkable design fact, compiled from the Blueprint.
 *
 * `property` and `expected` are strings so a color, a `56px` and a piece of
 * copy share one shape; `expectedNumber` carries the comparable value when
 * there is one, so a delta is arithmetic rather than string diffing.
 */
export const visualExpectationSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: visualExpectationKindSchema,
    blueprintRef: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    property: z.string().min(1).max(60),
    expected: z.string().min(1).max(400),
    expectedNumber: z.number().finite().optional(),
    /** Absolute tolerance for a numeric expectation, in the property's unit. */
    tolerance: z.number().nonnegative().optional(),
    severityIfMissing: visualFindingSeverityV1Schema.default("major"),
  })
  .strict();

export type VisualExpectation = z.infer<typeof visualExpectationSchema>;

// ── Critic interpretation ───────────────────────────────────────

export const visualCriticAnnotationSchema = z
  .object({
    /** The deterministic finding this interprets. Never a new measurement. */
    findingId: z.string().min(1).max(200),
    severity: visualFindingSeverityV1Schema.optional(),
    priority: z.number().int().min(1).max(100).optional(),
    userVisibleImpact: z.string().min(1).max(400).optional(),
    likelyCauseCategory: z
      .enum(["styling", "layout", "component-choice", "content", "composition", "unknown"])
      .optional(),
    repairGuidance: z.string().min(1).max(400).optional(),
  })
  .strict();

export const visualCriticPatchSchema = z
  .object({
    schemaVersion: z.literal(VISUAL_DELTA_REPORT_SCHEMA_VERSION),
    partitionId: z.string().min(1).max(160),
    annotations: z.array(visualCriticAnnotationSchema).max(64).default([]),
    /** One bounded statement about the region as a whole. */
    summary: z.string().min(1).max(600).optional(),
    inconclusive: z
      .array(z.object({ findingId: z.string().min(1).max(200), reason: z.string().min(1).max(300) }).strict())
      .max(32)
      .default([]),
  })
  .strict();

export type VisualCriticPatch = z.infer<typeof visualCriticPatchSchema>;
export type VisualCriticAnnotation = z.infer<typeof visualCriticAnnotationSchema>;

/**
 * Fields a critic patch may never carry.
 *
 * The measurement belongs to the browser. A patch that "corrects" an expected
 * or actual value is not interpreting evidence, it is replacing it — the same
 * fact-override boundary the Blueprint and the Implementation Map draw.
 */
export const VISUAL_CRITIC_FORBIDDEN_FIELDS: readonly string[] = Object.freeze([
  "expectedValue",
  "actualValue",
  "measurableDelta",
  "origin",
  "boundingRegion",
  "category",
  "evidenceReferences",
  "implementationEvidenceId",
  "referenceEvidenceId",
  "screenshotArtifactId",
  "elements",
  "viewports",
  "pixelComparisons",
]);

// ── The report ──────────────────────────────────────────────────

export const visualOutcomeSchema = z.enum([
  "pass",
  "pass_with_findings",
  "needs_refinement",
  "inconclusive",
  "fail",
]);

export type VisualOutcome = z.infer<typeof visualOutcomeSchema>;

export const visualDeltaReportSchema = z
  .object({
    schemaVersion: z.literal(VISUAL_DELTA_REPORT_SCHEMA_VERSION),
    outcome: visualOutcomeSchema,
    binding: renderedStateBindingSchema,
    /** Every finding, deterministic ones with `origin: "deterministic"`. */
    findings: z.array(visualFindingV1Schema).max(256).default([]),
    annotations: z.array(visualCriticAnnotationSchema).max(256).default([]),
    expectationCount: z.number().int().nonnegative(),
    critic: z
      .object({
        status: z.enum(["completed", "partial", "unavailable", "not_requested"]),
        partitionCount: z.number().int().nonnegative().default(0),
        patchCount: z.number().int().nonnegative().default(0),
        agentId: z.string().min(1).max(120).optional(),
        agentVersion: z.string().min(1).max(40).optional(),
        modelProfileId: z.string().min(1).max(120).optional(),
        model: z.string().min(1).max(160).optional(),
        summaries: z.array(z.string().min(1).max(600)).max(16).default([]),
      })
      .strict(),
    /** Which inputs were allowed to affect the outcome. */
    passFailPolicy: z
      .object({
        criticalDeterministicFails: z.boolean(),
        majorDeterministicNeedsRefinement: z.boolean(),
        missingRequiredElementFails: z.boolean(),
        renderFailureIsFailure: z.boolean(),
        browserUnavailableIsInconclusive: z.boolean(),
        criticSeverityMayEscalate: z.boolean(),
      })
      .strict(),
    reason: z.string().min(1).max(400).optional(),
  })
  .strict();

export type VisualDeltaReport = z.infer<typeof visualDeltaReportSchema>;

/** The policy V2-5 ships with. Every field says what may move the outcome. */
export const DEFAULT_VISUAL_PASS_FAIL_POLICY = Object.freeze({
  criticalDeterministicFails: true,
  majorDeterministicNeedsRefinement: true,
  missingRequiredElementFails: true,
  renderFailureIsFailure: true,
  browserUnavailableIsInconclusive: true,
  // The Critic may raise severity within an existing finding, never invent one
  // that changes the outcome on its own.
  criticSeverityMayEscalate: false,
});
