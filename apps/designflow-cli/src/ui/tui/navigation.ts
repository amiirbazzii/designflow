import type { DestinationCandidate } from "../../services/destinations";
import type { InteractiveDesign } from "../../services/figma-selection";
import type { ApprovalMode } from "./model";
import type { FreshUiState } from "./fresh-ui";
import type { FreshFrameEvidence } from "../../services/fresh-figma-evidence";
import type { ProposalReview, ReviewCheck } from "../../services/proposal-review";
import {
  backspaceText,
  deleteForwardText,
  insertText,
  moveTextCursor,
  moveTextCursorEnd,
  moveTextCursorHome,
  type TextEditorState,
} from "./text-input";

export interface TuiReviewRequest {
  readonly executionId: string;
  readonly workflowId: string;
  readonly reason: string;
  readonly review: ProposalReview;
  readonly checks: readonly ReviewCheck[];
}

export type TuiView =
  | "start"
  | "sign-in-required"
  | "signing-in"
  | "design-selection"
  | "figma-url-entry"
  | "ready-to-generate"
  | "destination-selection"
  | "approval-mode"
  | "ready-to-run"
  | "execution"
  | "proposal-review"
  | "diff-view"
  | "applying"
  | "validation-result"
  | "visual-result"
  | "correction-review"
  | "needs-attention"
  | "diagnostics-view"
  | "final-result"
  | "output-viewer"
  | "help";

export interface TuiNavigationState {
  readonly view: TuiView;
  readonly helpReturnView: Exclude<TuiView, "help">;
  readonly outputReturnView: Exclude<TuiView, "help" | "output-viewer">;
  readonly diagnosticsReturnView: Exclude<TuiView, "help" | "diagnostics-view">;
  readonly outputId?: string;
  readonly outputScrollOffset: number;
  readonly outputDetails: boolean;
  readonly review?: TuiReviewRequest;
  readonly reviewActionIndex: number;
  readonly reviewFileIndex: number;
  readonly diffScrollOffset: number;
  readonly outcomeActionIndex: number;
  readonly diffReturnView: Exclude<TuiView, "help" | "diff-view" | "output-viewer">;
  readonly approvalOption: number;
  readonly approvalMode: ApprovalMode;
  readonly designOption: number;
  readonly design?: InteractiveDesign | undefined;
  readonly freshState?: Extract<FreshUiState, { readonly status: "ready-to-generate" }> | undefined;
  readonly freshEvidence?: FreshFrameEvidence | undefined;
  readonly urlValue: string;
  readonly urlCursor: number;
  readonly urlViewportStart: number;
  readonly urlError?: string | undefined;
  readonly destinationCandidates: readonly DestinationCandidate[];
  readonly destinationIndex: number;
  readonly destinationScrollOffset: number;
  readonly loading: "current-selection" | "destinations" | "fresh-evidence" | null;
  readonly authError?: string | undefined;
  readonly authBrowserFallback?: string | undefined;
  readonly error?: string | undefined;
}

export function initialNavigationState(): TuiNavigationState {
  return {
    view: "start",
    helpReturnView: "start",
    outputReturnView: "execution",
    diagnosticsReturnView: "needs-attention",
    outputScrollOffset: 0,
    outputDetails: false,
    reviewActionIndex: 0,
    reviewFileIndex: 0,
    diffScrollOffset: 0,
    outcomeActionIndex: 0,
    diffReturnView: "proposal-review",
    approvalOption: 0,
    approvalMode: "manual",
    designOption: 0,
    urlValue: "",
    urlCursor: 0,
    urlViewportStart: 0,
    destinationCandidates: [],
    destinationIndex: 0,
    destinationScrollOffset: 0,
    loading: null,
  };
}

export function openSignInRequired(
  state: TuiNavigationState,
  authError?: string,
): TuiNavigationState {
  return {
    ...state,
    view: "sign-in-required",
    authError,
    authBrowserFallback: undefined,
    error: undefined,
  };
}

export function openSigningIn(state: TuiNavigationState): TuiNavigationState {
  return {
    ...state,
    view: "signing-in",
    authError: undefined,
    authBrowserFallback: undefined,
    error: undefined,
  };
}

export function setAuthBrowserFallback(
  state: TuiNavigationState,
  url: string,
): TuiNavigationState {
  return { ...state, authBrowserFallback: url };
}

export function enterDesignSelection(
  state: TuiNavigationState,
): TuiNavigationState {
  return {
    ...state,
    view: "design-selection",
    error: undefined,
    urlError: undefined,
    loading: null,
    freshState: undefined,
    freshEvidence: undefined,
  };
}

export function enterUrlEntry(state: TuiNavigationState): TuiNavigationState {
  return {
    ...state,
    view: "figma-url-entry",
    urlValue: "",
    urlCursor: 0,
    urlViewportStart: 0,
    urlError: undefined,
    error: undefined,
    loading: null,
  };
}

export function setFreshReady(
  state: TuiNavigationState,
  freshState: Extract<FreshUiState, { readonly status: "ready-to-generate" }>,
): TuiNavigationState {
  return {
    ...state,
    view: "ready-to-generate",
    design: freshState.design,
    freshState,
    freshEvidence: undefined,
    error: undefined,
    urlError: undefined,
    loading: null,
  };
}

export function setFreshEvidenceLoading(state: TuiNavigationState): TuiNavigationState {
  return { ...state, loading: "fresh-evidence", error: undefined };
}

export function setFreshEvidence(
  state: TuiNavigationState,
  evidence: FreshFrameEvidence,
): TuiNavigationState {
  return {
    ...state,
    loading: null,
    freshEvidence: evidence,
    error: undefined,
  };
}

export function enterDestinationSelection(
  state: TuiNavigationState,
  design: InteractiveDesign,
): TuiNavigationState {
  return {
    ...state,
    view: "destination-selection",
    design,
    destinationIndex: 0,
    destinationScrollOffset: 0,
    error: undefined,
    urlError: undefined,
    loading: "destinations",
  };
}

export function setDestinationCandidates(
  state: TuiNavigationState,
  candidates: readonly DestinationCandidate[],
): TuiNavigationState {
  return {
    ...state,
    destinationCandidates: candidates,
    destinationIndex: Math.min(state.destinationIndex, Math.max(0, candidates.length - 1)),
    destinationScrollOffset: 0,
    loading: null,
    error: candidates.length === 0 ? "No destination suggestions available." : undefined,
  };
}

export function enterApprovalMode(state: TuiNavigationState): TuiNavigationState {
  return {
    ...state,
    view: "approval-mode",
    approvalOption: state.approvalMode === "manual" ? 0 : 1,
    error: undefined,
  };
}

export function setApprovalOption(
  state: TuiNavigationState,
  option: number,
): TuiNavigationState {
  const approvalMode: ApprovalMode = option === 1 ? "designflow" : "manual";
  return { ...state, approvalOption: option, approvalMode };
}

export function moveListSelection(
  index: number,
  count: number,
  delta: -1 | 1,
): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, index + delta), count - 1);
}

export function keepSelectionVisible(
  index: number,
  offset: number,
  visibleCount: number,
): number {
  const count = Math.max(1, visibleCount);
  if (index < offset) return index;
  if (index >= offset + count) return index - count + 1;
  return offset;
}

export function updateUrlText(
  state: TuiNavigationState,
  input: string,
): TuiNavigationState {
  return applyUrlEditor(state, insertText(urlEditor(state), input));
}

export function backspaceUrlText(state: TuiNavigationState): TuiNavigationState {
  return applyUrlEditor(state, backspaceText(urlEditor(state)));
}

export function deleteUrlText(state: TuiNavigationState): TuiNavigationState {
  return applyUrlEditor(state, deleteForwardText(urlEditor(state)));
}

export function moveUrlCursor(
  state: TuiNavigationState,
  delta: -1 | 1,
): TuiNavigationState {
  return applyUrlEditor(state, moveTextCursor(urlEditor(state), delta));
}

export function moveUrlCursorHome(state: TuiNavigationState): TuiNavigationState {
  return applyUrlEditor(state, moveTextCursorHome(urlEditor(state)));
}

export function moveUrlCursorEnd(state: TuiNavigationState): TuiNavigationState {
  return applyUrlEditor(state, moveTextCursorEnd(urlEditor(state)));
}

function urlEditor(state: TuiNavigationState): TextEditorState {
  return {
    value: state.urlValue,
    cursorIndex: state.urlCursor,
    viewportStart: state.urlViewportStart,
  };
}

function applyUrlEditor(state: TuiNavigationState, editor: TextEditorState): TuiNavigationState {
  return {
    ...state,
    urlValue: editor.value,
    urlCursor: editor.cursorIndex,
    urlViewportStart: editor.viewportStart,
    urlError: undefined,
  };
}

export function setUrlError(
  state: TuiNavigationState,
  urlError: string,
): TuiNavigationState {
  return { ...state, urlError, loading: null };
}

export function openHelp(state: TuiNavigationState): TuiNavigationState {
  if (state.view === "help") return { ...state, view: state.helpReturnView };
  return { ...state, view: "help", helpReturnView: state.view };
}

export function openProposalReview(
  state: TuiNavigationState,
  review: TuiReviewRequest,
): TuiNavigationState {
  return {
    ...state,
    view: "proposal-review",
    review,
    reviewActionIndex: 0,
    reviewFileIndex: 0,
    diffScrollOffset: 0,
    error: undefined,
  };
}

export function openDiffView(state: TuiNavigationState): TuiNavigationState {
  if (state.review === undefined) return state;
  return {
    ...state,
    view: "diff-view",
    diffReturnView: state.view === "correction-review" ? "correction-review" : "proposal-review",
    diffScrollOffset: 0,
  };
}

export function closeDiffView(state: TuiNavigationState): TuiNavigationState {
  return state.view === "diff-view"
    ? { ...state, view: state.diffReturnView, diffScrollOffset: 0 }
    : state;
}

export function setDiffScrollOffset(
  state: TuiNavigationState,
  offset: number,
  maximum: number,
): TuiNavigationState {
  return { ...state, diffScrollOffset: Math.min(Math.max(0, offset), Math.max(0, maximum)) };
}

export function moveReviewAction(state: TuiNavigationState, delta: -1 | 1): TuiNavigationState {
  return { ...state, reviewActionIndex: moveListSelection(state.reviewActionIndex, 3, delta) };
}

export function moveReviewFile(state: TuiNavigationState, delta: -1 | 1): TuiNavigationState {
  const count = state.review?.review.files.length ?? 0;
  return { ...state, reviewFileIndex: moveListSelection(state.reviewFileIndex, count, delta), diffScrollOffset: 0 };
}

export function openOutput(
  state: TuiNavigationState,
  outputId: string,
): TuiNavigationState {
  const returnView = state.view === "help" ? state.helpReturnView : state.view;
  return {
    ...state,
    view: "output-viewer",
    outputReturnView: returnView === "output-viewer" ? state.outputReturnView : returnView,
    outputId,
    outputScrollOffset: 0,
    outputDetails: false,
    error: undefined,
  };
}

export function closeOutput(state: TuiNavigationState): TuiNavigationState {
  if (state.view !== "output-viewer") return state;
  return {
    ...state,
    view: state.outputReturnView,
    outputScrollOffset: 0,
    outputDetails: false,
  };
}

export function setOutputScrollOffset(
  state: TuiNavigationState,
  offset: number,
  maximum: number,
): TuiNavigationState {
  return {
    ...state,
    outputScrollOffset: Math.min(Math.max(0, offset), Math.max(0, maximum)),
  };
}

export function toggleOutputDetails(state: TuiNavigationState): TuiNavigationState {
  return state.view === "output-viewer"
    ? { ...state, outputDetails: !state.outputDetails }
    : state;
}

export function closeHelp(state: TuiNavigationState): TuiNavigationState {
  return state.view === "help" ? { ...state, view: state.helpReturnView } : state;
}

export function openNeedsAttention(state: TuiNavigationState): TuiNavigationState {
  return { ...state, view: "needs-attention", outcomeActionIndex: 0 };
}

export function openDiagnosticsView(state: TuiNavigationState): TuiNavigationState {
  const returnView = state.view === "help" ? state.helpReturnView : state.view;
  return {
    ...state,
    view: "diagnostics-view",
    outputScrollOffset: 0,
    diagnosticsReturnView: returnView === "diagnostics-view" ? state.diagnosticsReturnView : returnView,
  };
}

export function moveOutcomeAction(
  state: TuiNavigationState,
  delta: -1 | 1,
  count: number,
): TuiNavigationState {
  return { ...state, outcomeActionIndex: moveListSelection(state.outcomeActionIndex, count, delta) };
}

export function navigateBack(state: TuiNavigationState): TuiNavigationState {
  if (state.view === "help") return closeHelp(state);
  if (state.view === "signing-in") return openSignInRequired(state);
  if (state.view === "sign-in-required") return { ...state, view: "start", authError: undefined, authBrowserFallback: undefined };
  if (state.view === "output-viewer") return closeOutput(state);
  if (state.view === "diff-view") return closeDiffView(state);
  if (state.view === "diagnostics-view") return { ...state, view: state.diagnosticsReturnView };
  if (state.view === "needs-attention") return { ...state, view: "start", outcomeActionIndex: 0 };
  if (state.view === "proposal-review" || state.view === "correction-review") {
    const { review: _review, ...withoutReview } = state;
    return { ...withoutReview, view: "execution" };
  }
  if (state.view === "final-result" || state.view === "visual-result" || state.view === "validation-result") return { ...state, view: "start", outcomeActionIndex: 0 };
  if (state.view === "ready-to-run") return { ...state, view: "approval-mode", error: undefined };
  if (state.view === "ready-to-generate") return enterDesignSelection(state);
  if (state.view === "approval-mode") return { ...state, view: "destination-selection", error: undefined };
  if (state.view === "destination-selection") return enterDesignSelection(state);
  if (state.view === "figma-url-entry") return enterDesignSelection(state);
  if (state.view === "design-selection") return { ...state, view: "start", error: undefined };
  return state;
}
