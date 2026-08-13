import {
  validateProposedModules,
  type ProposedModuleDiagnostic,
  type ProposedModuleValidationResult,
} from "@designflow/capability-implementation";
import type {
  Stage4ProjectImplementationContext,
  ProposedFileChanges,
  VisualViewportV1,
} from "@designflow/sdk";
import {
  captureWithPreview,
  loadOptionalPlaywrightRenderer,
  makePreviewTarget,
  type BrowserRenderer,
} from "../visual-validation/visual-validation-runtime";

export const MAX_CORRECTION_PROPOSAL_ATTEMPTS = 3;

export interface CorrectionRuntimePreflightResult {
  readonly proposalHash: string;
  readonly compile: ProposedModuleValidationResult;
  readonly runtime: {
    readonly status: "passed" | "failed" | "unavailable";
    readonly diagnostics: readonly ProposedModuleDiagnostic[];
  };
}

function diagnostic(message: string): ProposedModuleDiagnostic {
  return { message: message.slice(0, 500) };
}

function safeDiagnostic(message: string, workspace: string): string {
  return message
    .replaceAll(workspace, "[temporary-workspace]")
    .replace(/(?:\/private)?\/tmp\/[^\s:]+/g, "[temporary-path]")
    .replace(/(?:OPENROUTER_API_KEY|[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|KEY))\s*[=:]\s*[^\s]+/g, "[REDACTED]")
    .slice(0, 500);
}

async function runtimeInWorkspace(
  workspace: string,
  project: Stage4ProjectImplementationContext,
  viewports: readonly VisualViewportV1[],
  signal: AbortSignal,
  configuredRenderer?: BrowserRenderer,
): Promise<{ status: "passed" | "failed" | "unavailable"; diagnostics: readonly ProposedModuleDiagnostic[] }> {
  const target = await makePreviewTarget(project, "/");
  if (target === undefined)
    return { status: "unavailable", diagnostics: [diagnostic("No safe project preview command was available for runtime preflight.")] };
  const renderer = configuredRenderer ?? await loadOptionalPlaywrightRenderer();
  if (renderer === undefined)
    return { status: "unavailable", diagnostics: [diagnostic("Playwright or Chromium was unavailable for runtime preflight.")] };
  try {
    const result = await captureWithPreview(
      workspace,
      target,
      renderer,
      viewports,
      {
        fullPage: false,
        waitForFontsMs: 250,
        timeoutMs: Math.min(target.startupTimeoutMs, 15_000),
        maxImageBytes: 10_000_000,
        maxImagePixels: 8_000_000,
      },
      signal,
    );
    if (result.runtime.status !== "ready")
      return {
        status: "failed",
        diagnostics: [diagnostic(`Preview did not become ready: ${result.runtime.warnings.join("; ")}`)],
      };
    const runtimeErrors = result.captures.flatMap((capture) =>
      (capture.capture.runtimeErrors ?? []).map((message) => diagnostic(`pageerror: ${safeDiagnostic(message, workspace)}`)),
    );
    if (runtimeErrors.length > 0) return { status: "failed", diagnostics: runtimeErrors.slice(0, 12) };
    if (result.captures.length === 0)
      return { status: "failed", diagnostics: [diagnostic("Preview navigation produced no browser capture.")] };
    return { status: "passed", diagnostics: [] };
  } catch (error) {
    return {
      status: "failed",
      diagnostics: [diagnostic(`Preview navigation failed: ${safeDiagnostic(error instanceof Error ? error.message : String(error), workspace)}`)],
    };
  }
}

/**
 * Runs the exact correction proposal through the shared bounded project copy,
 * compile gate, and browser runtime gate. The callback is executed inside the
 * temporary workspace and the workspace is always removed by the implementation
 * validator after it returns.
 */
export async function preflightCorrectionProposal(
  root: string,
  project: Stage4ProjectImplementationContext,
  proposal: ProposedFileChanges,
  viewports: readonly VisualViewportV1[],
  signal: AbortSignal,
  configuredRenderer?: BrowserRenderer,
): Promise<CorrectionRuntimePreflightResult> {
  const compile = await validateProposedModules(root, proposal, {
    ...(project.commands.build !== undefined
      ? { buildCommand: { executable: project.commands.build.executable, args: project.commands.build.args ?? [] } }
      : {}),
    signal,
    postBuild: (workspace) => runtimeInWorkspace(workspace, project, viewports, signal, configuredRenderer),
  });
  return {
    proposalHash: compile.proposalHash,
    compile,
    runtime: compile.postBuild ?? {
      status: compile.status === "passed" ? "unavailable" : "failed",
      diagnostics: compile.status === "passed" ? [diagnostic("Runtime preflight did not run.")] : compile.diagnostics,
    },
  };
}
