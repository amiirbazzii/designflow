import type { ProposedModuleDiagnostic, ProposedModuleValidationResult } from "@designflow/capability-implementation";
import type {
  Stage4ProjectImplementationContext,
  ProposedFileChanges,
  RenderedState,
  VisualViewportV1,
} from "@designflow/sdk";
import { renderProposedState } from "../visual-validation/render-proposed-state";
import type { BrowserRenderer } from "../visual-validation/visual-validation-runtime";

export const MAX_CORRECTION_PROPOSAL_ATTEMPTS = 3;

export interface CorrectionRuntimePreflightResult {
  readonly proposalHash: string;
  readonly compile: ProposedModuleValidationResult;
  readonly runtime: {
    readonly status: "passed" | "failed" | "unavailable";
    readonly diagnostics: readonly ProposedModuleDiagnostic[];
  };
  /**
   * The evidence the render produced. The correction loop gates on
   * `runtime.status` alone, but V2-5 keeps the rendered state rather than
   * discarding it — this preflight was always a full render that threw its
   * pixels away.
   */
  readonly renderedState: RenderedState;
}

/**
 * Runs the exact correction proposal through the shared bounded project copy,
 * compile gate, and browser runtime gate.
 *
 * This is now a thin reading of the general renderer: the isolated workspace,
 * the real build, the preview server and the browser drive are identical work
 * whether the proposal came from the correction agent or from the UI Builder,
 * so there is one implementation of it and this function only translates the
 * result into the pass/fail vocabulary the correction loop expects.
 */
export async function preflightCorrectionProposal(
  root: string,
  project: Stage4ProjectImplementationContext,
  proposal: ProposedFileChanges,
  viewports: readonly VisualViewportV1[],
  signal: AbortSignal,
  configuredRenderer?: BrowserRenderer,
): Promise<CorrectionRuntimePreflightResult> {
  const result = await renderProposedState(root, project, proposal, {
    viewports,
    signal,
    ...(configuredRenderer !== undefined ? { renderer: configuredRenderer } : {}),
    // The correction gate never needed full-page images, and a viewport-sized
    // capture is materially cheaper on a large page.
    fullPage: false,
  });

  const { renderedState, compile } = result;
  const diagnostics: readonly ProposedModuleDiagnostic[] = renderedState.runtime.diagnostics.map((message) => ({ message }));

  // A page that threw at runtime is a failed correction, even though the
  // renderer keeps its screenshots as evidence.
  const threw = renderedState.viewports.some((viewport) => viewport.runtimeErrorCount > 0);

  const status: "passed" | "failed" | "unavailable" =
    renderedState.status === "browser_unavailable"
      ? "unavailable"
      : renderedState.status === "rendered" && !threw
        ? "passed"
        : "failed";

  return {
    proposalHash: compile.proposalHash,
    compile,
    runtime: {
      status,
      diagnostics: status === "passed" ? [] : diagnostics.slice(0, 12),
    },
    renderedState,
  };
}
