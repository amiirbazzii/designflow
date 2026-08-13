// workflows/workflow-design-to-code/src/visual-validation/render-proposed-state.ts
//
// Pre-approval rendering (Agent Architecture V2, phase V2-5).
//
// The capability already existed, but only inside visual *correction*: a
// correction proposal was materialized into an isolated workspace, built with
// the project's real build command, served by its real preview command and
// driven with a real browser — and then the pixels were thrown away, because
// the caller only wanted a pass/fail runtime gate.
//
// This is that same machinery with the evidence kept. It answers the question
// the product could not previously answer before a person approves anything:
// *what does this actually look like when it runs?*
//
// Two properties matter and are structural, not conventional:
//
//   - The render happens in a temporary copy. `validateProposedModules` owns
//     the workspace lifecycle and always removes it, so the user's registered
//     project is never written to, built in, or served from.
//   - What is rendered is the exact validated proposal, identified by
//     `proposalHash`. No code is regenerated between validation and render, so
//     "the screenshots show the thing you are approving" is checkable rather
//     than assumed.
import {
  validateProposedModules,
  type ProposedModuleDiagnostic,
  type ProposedModuleValidationResult,
} from "@designflow/capability-implementation";
import {
  RENDERED_STATE_SCHEMA_VERSION,
  renderedStateSchema,
  type ImplementationMap,
  type PixelComparison,
  type ProposedFileChanges,
  type RenderedState,
  type RenderedViewport,
  type Stage4ProjectImplementationContext,
  type VisualViewportV1,
} from "@designflow/sdk";
import { createHash } from "node:crypto";

import { instrumentProposal } from "./render-instrumentation";
import {
  captureWithPreview,
  comparePngImages,
  loadOptionalPlaywrightRenderer,
  makePreviewTarget,
  type BrowserCapture,
  type BrowserRenderer,
  type DomElementEvidence,
} from "./visual-validation-runtime";

export const RENDERER_VERSION = "1.0.0";

/** Elements the RenderedState contract will accept from one render. */
const MAX_RENDERED_ELEMENTS = 256;

export interface RenderProposedStateOptions {
  readonly viewports: readonly VisualViewportV1[];
  readonly signal: AbortSignal;
  /** Test/composition-root seam; production loads Playwright. */
  readonly renderer?: BrowserRenderer;
  readonly route?: string;
  readonly fullPage?: boolean;
  readonly binding?: {
    readonly blueprintArtifactId?: string;
    readonly implementationMapArtifactId?: string;
    readonly proposalArtifactId?: string;
    readonly projectFingerprint?: string;
  };
  /**
   * Fingerprint the project had when the proposal was planned. When it no
   * longer matches, the render is refused rather than producing screenshots of
   * a project state the plan never described.
   */
  readonly expectedProjectFingerprint?: string;
  readonly currentProjectFingerprint?: string;
  /**
   * The plan, used to derive host-owned correspondence markers.
   *
   * Without it the render still works and still measures; elements with no
   * visible copy simply cannot be identified as confidently.
   */
  readonly implementationMap?: ImplementationMap;
  /** Set false to render exactly the proposal bytes, with no markers. */
  readonly instrument?: boolean;
  /** The design's own screenshots, for real pixel comparison. */
  readonly reference?: readonly ReferenceScreenshot[];
  /** The design identity the Blueprint was compiled from, checked before comparing. */
  readonly referenceIdentity?: { readonly fileKey?: string; readonly nodeId?: string };
}

/**
 * A design screenshot to compare against.
 *
 * `identity` is checked before comparing: an image from another file or
 * another node is not a reference, it is a different design, and comparing
 * against it would produce a large, confident, meaningless mismatch.
 */
export interface ReferenceScreenshot {
  readonly viewportId: string;
  readonly bytes: Uint8Array;
  readonly evidenceId?: string;
  readonly artifactId?: string;
  readonly identity?: { readonly fileKey?: string; readonly nodeId?: string; readonly captureMethod?: string };
}

export interface RenderedCapture {
  readonly viewport: VisualViewportV1;
  readonly capture: BrowserCapture;
}

export interface RenderProposedStateResult {
  readonly renderedState: RenderedState;
  readonly compile: ProposedModuleValidationResult;
  /**
   * Screenshot bytes and DOM evidence, kept in memory for the caller to store
   * as artifacts. `RenderedState` itself carries only hashes and references.
   */
  readonly captures: readonly RenderedCapture[];
}

function diagnostic(message: string): ProposedModuleDiagnostic {
  return { message: message.slice(0, 500) };
}

/**
 * Strips anything a diagnostic must never carry out of the workspace.
 *
 * Temporary paths leak the machine's layout and are meaningless to the reader;
 * an environment assignment that reached a build log is a credential the
 * moment it reaches an artifact.
 */
export function redactDiagnostic(message: string, workspace: string): string {
  return message
    .replaceAll(workspace, "[temporary-workspace]")
    .replace(/(?:\/private)?\/tmp\/[^\s:]+/g, "[temporary-path]")
    .replace(
      /(?:OPENROUTER_API_KEY|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|KEY))\s*[=:]\s*[^\s]+/g,
      "[REDACTED]",
    )
    .slice(0, 500);
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A stable identity for the preview, never the live URL it was served on. */
function previewIdentity(route: string): string {
  return `preview:${route}`;
}

interface WorkspaceRenderOutcome {
  readonly status: "rendered" | "render_failed" | "browser_unavailable";
  readonly captures: readonly RenderedCapture[];
  readonly previewStatus: "ready" | "failed" | "unavailable";
  readonly diagnostics: readonly ProposedModuleDiagnostic[];
  readonly captureMs?: number;
}

async function renderInWorkspace(
  workspace: string,
  project: Stage4ProjectImplementationContext,
  options: RenderProposedStateOptions,
): Promise<WorkspaceRenderOutcome> {
  const route = options.route ?? "/";
  const target = await makePreviewTarget(project, route);
  if (target === undefined)
    return {
      status: "browser_unavailable",
      captures: [],
      previewStatus: "unavailable",
      diagnostics: [diagnostic("No safe project preview command was available, so the proposal could not be rendered.")],
    };

  const renderer = options.renderer ?? (await loadOptionalPlaywrightRenderer());
  if (renderer === undefined)
    return {
      status: "browser_unavailable",
      captures: [],
      previewStatus: "unavailable",
      diagnostics: [diagnostic("Playwright or Chromium was unavailable, so the proposal could not be rendered.")],
    };

  const startedAt = performance.now();
  try {
    const result = await captureWithPreview(
      workspace,
      target,
      renderer,
      options.viewports,
      {
        fullPage: options.fullPage ?? true,
        waitForFontsMs: 250,
        timeoutMs: Math.min(target.startupTimeoutMs, 15_000),
        maxImageBytes: 10_000_000,
        maxImagePixels: 8_000_000,
      },
      options.signal,
    );
    const captureMs = performance.now() - startedAt;

    if (result.runtime.status !== "ready")
      return {
        status: "render_failed",
        captures: [],
        previewStatus: result.runtime.status === "unavailable" ? "unavailable" : "failed",
        diagnostics: [
          diagnostic(
            `Preview did not become ready: ${redactDiagnostic(result.runtime.warnings.join("; "), workspace) || "no reason reported"}`,
          ),
        ],
        captureMs,
      };

    if (result.captures.length === 0)
      return {
        status: "render_failed",
        captures: [],
        previewStatus: "ready",
        diagnostics: [diagnostic("Preview navigation produced no browser capture.")],
        captureMs,
      };

    return {
      status: "rendered",
      captures: result.captures,
      previewStatus: "ready",
      // Runtime errors are evidence here, not a gate: a page that throws in one
      // widget still shows the reviewer what the rest of the screen looks like,
      // and the deterministic evaluator decides what that costs.
      diagnostics: result.captures
        .flatMap((entry) =>
          (entry.capture.runtimeErrors ?? []).map((message) =>
            diagnostic(`pageerror (${entry.viewport.id}): ${redactDiagnostic(message, workspace)}`),
          ),
        )
        .slice(0, 12),
      captureMs,
    };
  } catch (error) {
    return {
      status: "render_failed",
      captures: [],
      previewStatus: "failed",
      diagnostics: [
        diagnostic(
          `Preview navigation failed: ${redactDiagnostic(error instanceof Error ? error.message : String(error), workspace)}`,
        ),
      ],
      captureMs: performance.now() - startedAt,
    };
  }
}

/**
 * Compares one rendered viewport against the design's own screenshot.
 *
 * Every outcome is named. "No reference existed", "the images are not
 * comparable" and "the reference is of a different design" are three different
 * answers, and none of them is a mismatch ratio of zero — a comparison that
 * did not happen must never read as a comparison that found nothing wrong.
 */
export function comparePixels(
  entry: RenderedCapture,
  references: readonly ReferenceScreenshot[],
  expectedIdentity?: { readonly fileKey?: string; readonly nodeId?: string },
): PixelComparison {
  const reference = references.find((candidate) => candidate.viewportId === entry.viewport.id);
  const actualViewport = { width: entry.capture.width, height: entry.capture.height };

  if (reference === undefined)
    return {
      viewportId: entry.viewport.id,
      status: "unavailable",
      actualViewport,
      alignmentStatus: "unknown",
      reason: "The design evidence carried no reference screenshot for this viewport.",
    };

  // The reference must be of the same design the Blueprint was compiled from.
  if (expectedIdentity !== undefined && reference.identity !== undefined) {
    const fileMismatch =
      expectedIdentity.fileKey !== undefined &&
      reference.identity.fileKey !== undefined &&
      expectedIdentity.fileKey !== reference.identity.fileKey;
    const nodeMismatch =
      expectedIdentity.nodeId !== undefined &&
      reference.identity.nodeId !== undefined &&
      expectedIdentity.nodeId !== reference.identity.nodeId;
    if (fileMismatch || nodeMismatch)
      return {
        viewportId: entry.viewport.id,
        status: "identity_mismatch",
        actualViewport,
        alignmentStatus: "unknown",
        ...(reference.evidenceId !== undefined ? { referenceEvidenceId: reference.evidenceId } : {}),
        ...(reference.artifactId !== undefined ? { referenceArtifactId: reference.artifactId } : {}),
        referenceIdentity: reference.identity,
        reason: "The available reference screenshot is of a different design node than this Blueprint.",
      };
  }

  try {
    const comparison = comparePngImages(reference.bytes, entry.capture.bytes);
    return {
      viewportId: entry.viewport.id,
      status: "compared",
      algorithmVersion: comparison.algorithmVersion,
      mismatchRatio: comparison.mismatchRatio,
      dimensionCompatible: comparison.dimensionCompatible,
      overlapCoverage: comparison.overlapCoverage,
      overlapMismatchRatio: comparison.overlapMismatchRatio,
      changedPixelCount: comparison.changedPixelCount,
      expectedViewport: { width: comparison.referenceWidth, height: comparison.referenceHeight },
      actualViewport: { width: comparison.implementationWidth, height: comparison.implementationHeight },
      alignmentStatus: comparison.dimensionCompatible ? "aligned" : "overlap-compared",
      ...(reference.evidenceId !== undefined ? { referenceEvidenceId: reference.evidenceId } : {}),
      ...(reference.artifactId !== undefined ? { referenceArtifactId: reference.artifactId } : {}),
      ...(reference.identity !== undefined ? { referenceIdentity: reference.identity } : {}),
    };
  } catch (error) {
    return {
      viewportId: entry.viewport.id,
      status: "incompatible",
      actualViewport,
      alignmentStatus: "incompatible",
      ...(reference.evidenceId !== undefined ? { referenceEvidenceId: reference.evidenceId } : {}),
      reason: (error instanceof Error ? error.message : "The two images could not be compared.").slice(0, 300),
    };
  }
}

function toViewportRecord(entry: RenderedCapture): RenderedViewport {
  return {
    id: entry.viewport.id,
    width: entry.viewport.width,
    height: entry.viewport.height,
    capturedWidth: entry.capture.width,
    capturedHeight: entry.capture.height,
    captureStatus: "captured",
    screenshotContentHash: hash(entry.capture.bytes),
    domEvidenceStatus: entry.capture.dom === undefined ? "unavailable" : "captured",
    consoleErrorCount: entry.capture.consoleErrors.length,
    runtimeErrorCount: (entry.capture.runtimeErrors ?? []).length,
    warnings: entry.capture.warnings.slice(0, 12).map((warning) => warning.slice(0, 300)),
  };
}

function toElementEvidence(entry: RenderedCapture, element: DomElementEvidence) {
  return {
    viewportId: entry.viewport.id,
    selector: element.selector.slice(0, 400),
    ...(element.instrumentationRef !== undefined && element.instrumentationRef.length > 0
      ? { instrumentationRef: element.instrumentationRef.slice(0, 200) }
      : {}),
    ...(element.tagName !== undefined ? { tagName: element.tagName.slice(0, 40) } : {}),
    ancestorPath: (element.ancestorPath ?? []).slice(0, 12).map((step) => step.slice(0, 120)),
    ...(element.siblingIndex !== undefined ? { siblingIndex: element.siblingIndex } : {}),
    ...(element.assetSource !== undefined && element.assetSource.length > 0
      ? { assetSource: element.assetSource.slice(0, 500) }
      : {}),
    ...(element.borderColor !== undefined ? { borderColor: element.borderColor } : {}),
    ...(element.fontFamily !== undefined ? { fontFamily: element.fontFamily.slice(0, 160) } : {}),
    ...(element.text !== undefined ? { text: element.text.slice(0, 2_000) } : {}),
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    ...(element.display !== undefined ? { display: element.display } : {}),
    ...(element.visibility !== undefined ? { visibility: element.visibility } : {}),
    ...(element.color !== undefined ? { color: element.color } : {}),
    ...(element.backgroundColor !== undefined ? { backgroundColor: element.backgroundColor } : {}),
    ...(element.borderRadius !== undefined ? { borderRadius: element.borderRadius } : {}),
    ...(element.fontSize !== undefined ? { fontSize: element.fontSize } : {}),
    ...(element.fontWeight !== undefined ? { fontWeight: element.fontWeight } : {}),
    ...(element.padding !== undefined ? { padding: element.padding } : {}),
    ...(element.margin !== undefined ? { margin: element.margin } : {}),
  };
}

function emptyState(
  status: RenderedState["status"],
  proposalHash: string,
  options: RenderProposedStateOptions,
  provenance: RenderedState["provenance"],
  runtime: RenderedState["runtime"],
): RenderedState {
  return renderedStateSchema.parse({
    schemaVersion: RENDERED_STATE_SCHEMA_VERSION,
    status,
    binding: { proposalHash, ...(options.binding ?? {}) },
    viewports: [],
    elements: [],
    pixelComparisons: [],
    correspondences: [],
    runtime,
    provenance,
  });
}

/** Provenance for a render that never reached the workspace. */
const UNINSTRUMENTED_PROVENANCE: RenderedState["provenance"] = {
  rendererVersion: RENDERER_VERSION,
  workspaceIsolated: true,
  renderInstrumentationApplied: false,
  instrumentedFileCount: 0,
  instrumentationNotes: [],
};

/**
 * Materializes a validated proposal in an isolated workspace and renders it.
 *
 * Works for any `ProposedFileChanges` — an initial UI Builder proposal, a
 * visual repair, or a correction — because nothing here knows which agent
 * produced the files. That generality is the point: rendering was previously
 * reachable only through the correction loop, which is why a first
 * implementation could never be seen before it was applied.
 */
export async function renderProposedState(
  root: string,
  project: Stage4ProjectImplementationContext,
  proposal: ProposedFileChanges,
  options: RenderProposedStateOptions,
): Promise<RenderProposedStateResult> {
  const proposalHash = createHash("sha256").update(JSON.stringify(proposal)).digest("hex");

  // The plan described a project state. If that state moved, screenshots of
  // the new one would be evidence about something nobody planned.
  if (
    options.expectedProjectFingerprint !== undefined &&
    options.currentProjectFingerprint !== undefined &&
    options.expectedProjectFingerprint !== options.currentProjectFingerprint
  ) {
    return {
      renderedState: emptyState("project_changed_before_render", proposalHash, options, UNINSTRUMENTED_PROVENANCE, {
        buildStatus: "unavailable",
        previewStatus: "unavailable",
        diagnostics: ["The project changed after this proposal was planned, so it was not rendered."],
      }),
      compile: {
        status: "unavailable",
        validatedFiles: [],
        proposalHash,
        diagnostics: [diagnostic("The project changed after this proposal was planned.")],
      },
      captures: [],
    };
  }

  // Host-owned correspondence markers, for the throwaway copy only.
  const instrumentation =
    options.instrument === false
      ? { proposal, applied: false, instrumentedFileCount: 0, notes: [] as readonly string[] }
      : instrumentProposal(proposal, options.implementationMap);

  let outcome: WorkspaceRenderOutcome | undefined;
  let workspacePath = "";
  let buildMs: number | undefined;

  const runOnce = async (
    candidate: ProposedFileChanges,
  ): Promise<Awaited<ReturnType<typeof validateProposedModules>>> => {
    outcome = undefined;
    const buildStartedAt = performance.now();
    return validateProposedModules(root, candidate, {
      ...(project.commands.build !== undefined
        ? { buildCommand: { executable: project.commands.build.executable, args: project.commands.build.args ?? [] } }
        : {}),
      signal: options.signal,
      postBuild: async (workspace) => {
        workspacePath = workspace;
        buildMs = performance.now() - buildStartedAt;
        outcome = await renderInWorkspace(workspace, project, options);
        // The validator's own vocabulary: it gates on pass/fail, and a render
        // that produced evidence has passed whatever gate the caller wanted.
        return {
          status:
            outcome.status === "rendered"
              ? "passed"
              : outcome.status === "browser_unavailable"
                ? "unavailable"
                : "failed",
          diagnostics: outcome.diagnostics,
        };
      },
    });
  };

  let compile = await runOnce(instrumentation.proposal);
  const instrumentationNotes = [...instrumentation.notes];
  let instrumented = instrumentation.applied;

  // Build-verified: markers are a convenience, never a reason a proposal fails
  // to render. If the instrumented copy will not build, the original does the
  // work and the report says correspondence had weaker evidence to go on.
  if (instrumented && compile.status === "failed" && !options.signal.aborted) {
    const fallback = await runOnce(proposal);
    if (fallback.status !== "failed") {
      instrumentationNotes.push(
        "The instrumented workspace did not build, so the exact proposal was rendered without correspondence markers.",
      );
      instrumented = false;
      compile = fallback;
    } else {
      // Both failed: the proposal itself is broken, which is the real finding.
      compile = fallback;
      instrumented = false;
    }
  }

  const instrumentedProposalHash = instrumented
    ? createHash("sha256").update(JSON.stringify(instrumentation.proposal)).digest("hex")
    : undefined;

  const provenance = {
    rendererVersion: RENDERER_VERSION,
    workspaceIsolated: true as const,
    renderInstrumentationApplied: instrumented,
    ...(instrumentedProposalHash !== undefined ? { instrumentedProposalHash } : {}),
    instrumentedFileCount: instrumented ? instrumentation.instrumentedFileCount : 0,
    instrumentationNotes: instrumentationNotes.slice(0, 8),
  };

  if (options.signal.aborted)
    return {
      renderedState: emptyState("cancelled", proposalHash, options, provenance, {
        buildStatus: compile.status === "passed" ? "passed" : "failed",
        previewStatus: "unavailable",
        diagnostics: ["Rendering was cancelled."],
      }),
      compile,
      captures: [],
    };

  // A proposal that does not compile has no rendered state to describe. The
  // compile diagnostics are the answer, and they already exist.
  if (outcome === undefined)
    return {
      renderedState: emptyState("render_failed", proposalHash, options, provenance, {
        buildStatus: compile.status === "passed" ? "unavailable" : "failed",
        previewStatus: "unavailable",
        ...(buildMs !== undefined ? { buildMs } : {}),
        diagnostics: compile.diagnostics
          .slice(0, 12)
          .map((entry) => redactDiagnostic(entry.message, workspacePath || root)),
      }),
      compile,
      captures: [],
    };

  const captures = outcome.captures;
  const elements = captures
    .flatMap((entry) => (entry.capture.dom?.elements ?? []).map((element) => toElementEvidence(entry, element)))
    .slice(0, MAX_RENDERED_ELEMENTS);

  const references = options.reference ?? [];
  const pixelComparisons = captures.slice(0, 8).map((entry) =>
    comparePixels(entry, references, options.referenceIdentity),
  );

  const renderedState = renderedStateSchema.parse({
    schemaVersion: RENDERED_STATE_SCHEMA_VERSION,
    status: outcome.status,
    // Always the validated proposal, never the instrumented copy. What was
    // built is named separately in `provenance.instrumentedProposalHash`.
    binding: { proposalHash, ...(options.binding ?? {}) },
    viewports: captures.slice(0, 8).map(toViewportRecord),
    elements,
    pixelComparisons,
    correspondences: [],
    runtime: {
      buildStatus: compile.status === "passed" ? "passed" : "failed",
      previewStatus: outcome.previewStatus,
      previewIdentity: previewIdentity(options.route ?? "/"),
      ...(buildMs !== undefined ? { buildMs } : {}),
      ...(outcome.captureMs !== undefined ? { captureMs: outcome.captureMs } : {}),
      diagnostics: outcome.diagnostics.slice(0, 12).map((entry) => entry.message),
    },
    provenance,
  });

  return { renderedState, compile, captures };
}
