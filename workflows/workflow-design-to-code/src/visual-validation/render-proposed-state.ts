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
  type ProposedFileChanges,
  type RenderedState,
  type RenderedViewport,
  type Stage4ProjectImplementationContext,
  type VisualViewportV1,
} from "@designflow/sdk";
import { createHash } from "node:crypto";

import {
  captureWithPreview,
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

function toViewportRecord(entry: RenderedCapture): RenderedViewport {
  return {
    id: entry.viewport.id,
    width: entry.viewport.width,
    height: entry.viewport.height,
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
  runtime: RenderedState["runtime"],
): RenderedState {
  return renderedStateSchema.parse({
    schemaVersion: RENDERED_STATE_SCHEMA_VERSION,
    status,
    binding: { proposalHash, ...(options.binding ?? {}) },
    viewports: [],
    elements: [],
    pixelComparisons: [],
    runtime,
    provenance: { rendererVersion: RENDERER_VERSION, workspaceIsolated: true },
  });
}

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
      renderedState: emptyState("project_changed_before_render", proposalHash, options, {
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

  let outcome: WorkspaceRenderOutcome | undefined;
  let workspacePath = "";
  const buildStartedAt = performance.now();
  let buildMs: number | undefined;

  const compile = await validateProposedModules(root, proposal, {
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
          outcome.status === "rendered" ? "passed" : outcome.status === "browser_unavailable" ? "unavailable" : "failed",
        diagnostics: outcome.diagnostics,
      };
    },
  });

  if (options.signal.aborted)
    return {
      renderedState: emptyState("cancelled", compile.proposalHash, options, {
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
      renderedState: emptyState("render_failed", compile.proposalHash, options, {
        buildStatus: compile.status === "passed" ? "unavailable" : "failed",
        previewStatus: "unavailable",
        buildMs: buildMs ?? performance.now() - buildStartedAt,
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

  const renderedState = renderedStateSchema.parse({
    schemaVersion: RENDERED_STATE_SCHEMA_VERSION,
    status: outcome.status,
    binding: { proposalHash: compile.proposalHash, ...(options.binding ?? {}) },
    viewports: captures.slice(0, 8).map(toViewportRecord),
    elements,
    pixelComparisons: [],
    runtime: {
      buildStatus: compile.status === "passed" ? "passed" : "failed",
      previewStatus: outcome.previewStatus,
      previewIdentity: previewIdentity(options.route ?? "/"),
      ...(buildMs !== undefined ? { buildMs } : {}),
      ...(outcome.captureMs !== undefined ? { captureMs: outcome.captureMs } : {}),
      diagnostics: outcome.diagnostics.slice(0, 12).map((entry) => entry.message),
    },
    provenance: { rendererVersion: RENDERER_VERSION, workspaceIsolated: true },
  });

  return { renderedState, compile, captures };
}
