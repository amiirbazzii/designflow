import type { DestinationCandidate } from "../../services/destinations";
import type { InteractiveDesign } from "../../services/figma-selection";

export type TuiView =
  | "start"
  | "design-selection"
  | "figma-url-entry"
  | "destination-selection"
  | "ready-to-run"
  | "help";

export interface TuiNavigationState {
  readonly view: TuiView;
  readonly helpReturnView: Exclude<TuiView, "help">;
  readonly designOption: number;
  readonly design?: InteractiveDesign | undefined;
  readonly urlValue: string;
  readonly urlCursor: number;
  readonly urlError?: string | undefined;
  readonly destinationCandidates: readonly DestinationCandidate[];
  readonly destinationIndex: number;
  readonly destinationScrollOffset: number;
  readonly loading: "current-selection" | "destinations" | null;
  readonly error?: string | undefined;
}

export function initialNavigationState(): TuiNavigationState {
  return {
    view: "start",
    helpReturnView: "start",
    designOption: 0,
    urlValue: "",
    urlCursor: 0,
    destinationCandidates: [],
    destinationIndex: 0,
    destinationScrollOffset: 0,
    loading: null,
  };
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
  };
}

export function enterUrlEntry(state: TuiNavigationState): TuiNavigationState {
  return {
    ...state,
    view: "figma-url-entry",
    urlValue: "",
    urlCursor: 0,
    urlError: undefined,
    error: undefined,
    loading: null,
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
  const value = state.urlValue.slice(0, state.urlCursor) + input + state.urlValue.slice(state.urlCursor);
  return {
    ...state,
    urlValue: value,
    urlCursor: state.urlCursor + input.length,
    urlError: undefined,
  };
}

export function backspaceUrlText(state: TuiNavigationState): TuiNavigationState {
  if (state.urlCursor === 0) return state;
  return {
    ...state,
    urlValue: state.urlValue.slice(0, state.urlCursor - 1) + state.urlValue.slice(state.urlCursor),
    urlCursor: state.urlCursor - 1,
    urlError: undefined,
  };
}

export function deleteUrlText(state: TuiNavigationState): TuiNavigationState {
  if (state.urlCursor >= state.urlValue.length) return state;
  return {
    ...state,
    urlValue: state.urlValue.slice(0, state.urlCursor) + state.urlValue.slice(state.urlCursor + 1),
    urlError: undefined,
  };
}

export function moveUrlCursor(
  state: TuiNavigationState,
  delta: -1 | 1,
): TuiNavigationState {
  return {
    ...state,
    urlCursor: Math.min(Math.max(0, state.urlCursor + delta), state.urlValue.length),
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

export function closeHelp(state: TuiNavigationState): TuiNavigationState {
  return state.view === "help" ? { ...state, view: state.helpReturnView } : state;
}

export function navigateBack(state: TuiNavigationState): TuiNavigationState {
  if (state.view === "help") return closeHelp(state);
  if (state.view === "ready-to-run") return { ...state, view: "destination-selection", error: undefined };
  if (state.view === "destination-selection") return enterDesignSelection(state);
  if (state.view === "figma-url-entry") return enterDesignSelection(state);
  if (state.view === "design-selection") return { ...state, view: "start", error: undefined };
  return state;
}
