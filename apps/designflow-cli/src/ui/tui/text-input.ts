export interface TextEditorState {
  readonly value: string;
  readonly cursorIndex: number;
  readonly viewportStart: number;
}

export interface TuiPromptState extends TextEditorState {
  readonly question: string;
  readonly options?: readonly string[];
  readonly optionIndex: number;
}

export function createTextEditor(value = ""): TextEditorState {
  return { value, cursorIndex: value.length, viewportStart: 0 };
}

export function insertText(state: TextEditorState, input: string): TextEditorState {
  if (input.length === 0) return state;
  const value = state.value.slice(0, state.cursorIndex) + input + state.value.slice(state.cursorIndex);
  return normalizeEditor({ ...state, value, cursorIndex: state.cursorIndex + input.length });
}

export function backspaceText(state: TextEditorState): TextEditorState {
  if (state.cursorIndex === 0) return normalizeEditor(state);
  return normalizeEditor({
    ...state,
    value: state.value.slice(0, state.cursorIndex - 1) + state.value.slice(state.cursorIndex),
    cursorIndex: state.cursorIndex - 1,
  });
}

export function deleteForwardText(state: TextEditorState): TextEditorState {
  if (state.cursorIndex >= state.value.length) return normalizeEditor(state);
  return normalizeEditor({
    ...state,
    value: state.value.slice(0, state.cursorIndex) + state.value.slice(state.cursorIndex + 1),
  });
}

export function moveTextCursor(state: TextEditorState, delta: -1 | 1): TextEditorState {
  return normalizeEditor({ ...state, cursorIndex: state.cursorIndex + delta });
}

export function moveTextCursorHome(state: TextEditorState): TextEditorState {
  return normalizeEditor({ ...state, cursorIndex: 0 });
}

export function moveTextCursorEnd(state: TextEditorState): TextEditorState {
  return normalizeEditor({ ...state, cursorIndex: state.value.length });
}

export function ensureTextCursorVisible(state: TextEditorState, viewportWidth: number): TextEditorState {
  const width = Math.max(1, Math.floor(viewportWidth));
  let viewportStart = Math.min(Math.max(0, state.viewportStart), state.value.length);
  if (state.cursorIndex < viewportStart) viewportStart = state.cursorIndex;
  if (state.cursorIndex >= viewportStart + width) viewportStart = state.cursorIndex - width + 1;
  return { ...normalizeEditor(state), viewportStart };
}

function normalizeEditor(state: TextEditorState): TextEditorState {
  const cursorIndex = Math.min(Math.max(0, Math.floor(state.cursorIndex)), state.value.length);
  return {
    ...state,
    cursorIndex,
    viewportStart: Math.min(Math.max(0, Math.floor(state.viewportStart)), state.value.length),
  };
}
