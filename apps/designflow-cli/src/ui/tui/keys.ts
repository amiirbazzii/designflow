import type { Key } from "ink";

export type TuiKeyAction =
  | "activate"
  | "up"
  | "down"
  | "next-focus"
  | "previous-focus"
  | "help"
  | "back"
  | "quit"
  | "interrupt"
  | "none";

export function mapTuiKey(input: string, key: Key): TuiKeyAction {
  if (key.ctrl && input === "c") return "interrupt";
  if (key.return || input === "\n" || input === "\r") return "activate";
  if (key.upArrow || input === "k") return "up";
  if (key.downArrow || input === "j") return "down";
  if (key.tab && key.shift) return "previous-focus";
  if (key.tab) return "next-focus";
  if (input === "?") return "help";
  if (key.escape) return "back";
  if (input === "q") return "quit";
  return "none";
}

/** Ink maps terminal DEL (0x7f) to `key.delete`, although users mean Backspace. */
export function isBackspaceInput(input: string, key: Key, rawInput?: string): boolean {
  return key.backspace || input === "\b" || input === "\u007f" || rawInput === "\b" || rawInput === "\u007f";
}

/** Forward Delete is the CSI 3~ sequence; DEL remains backward deletion. */
export function isForwardDeleteInput(input: string, key: Key, rawInput?: string): boolean {
  return key.delete === true && !isBackspaceInput(input, key, rawInput);
}

export function isHomeInput(input: string, rawInput?: string): boolean {
  return input === "\u001b[H" || input === "\u001bOH" || rawInput === "\u001b[H" || rawInput === "\u001bOH";
}

export function isEndInput(input: string, rawInput?: string): boolean {
  return input === "\u001b[F" || input === "\u001bOF" || rawInput === "\u001b[F" || rawInput === "\u001bOF";
}

export interface TuiInteractionState {
  readonly helpOpen: boolean;
  readonly focusArea: "workflow" | "outputs" | "main";
  readonly selectedStage: number;
  readonly selectedOutput: number;
}

export function reduceTuiInteraction(
  state: TuiInteractionState,
  action: TuiKeyAction,
  stageCount: number,
): TuiInteractionState {
  if (action === "help") return { ...state, helpOpen: true };
  if (action === "back" && state.helpOpen) return { ...state, helpOpen: false };
  if (action === "next-focus") {
    return {
      ...state,
      focusArea: state.focusArea === "workflow" ? "outputs" : state.focusArea === "outputs" ? "main" : "workflow",
    };
  }
  if (action === "previous-focus") {
    return {
      ...state,
      focusArea: state.focusArea === "main" ? "outputs" : state.focusArea === "outputs" ? "workflow" : "main",
    };
  }
  if (action === "up" && state.focusArea === "workflow") {
    return { ...state, selectedStage: Math.max(0, state.selectedStage - 1) };
  }
  if (action === "down" && state.focusArea === "workflow") {
    return { ...state, selectedStage: Math.min(Math.max(0, stageCount - 1), state.selectedStage + 1) };
  }
  if (action === "up" && state.focusArea === "outputs") {
    return { ...state, selectedOutput: Math.max(0, state.selectedOutput - 1) };
  }
  if (action === "down" && state.focusArea === "outputs") {
    return { ...state, selectedOutput: Math.max(0, state.selectedOutput + 1) };
  }
  return state;
}

export function isCompactTerminal(columns: number, rows: number): boolean {
  return columns < 72 || rows < 18;
}
