const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

/** Strip terminal bracketed-paste framing from Ink's input chunk. */
export function stripBracketedPasteMarkers(input: string): string {
  return input.replaceAll(BRACKETED_PASTE_START, "").replaceAll(BRACKETED_PASTE_END, "");
}

/** Return the single-line content width available to the URL viewport. */
export function urlInputContentWidth(columns: number, compact: boolean): number {
  const safeColumns = Math.max(1, Math.floor(columns));
  const reserved = compact ? 2 : 28 + 6;
  return Math.max(12, safeColumns - reserved - 4);
}

export function urlInputBoxWidth(columns: number, compact: boolean): number {
  return urlInputContentWidth(columns, compact) + 4;
}

export function visibleUrlWindow(
  value: string,
  cursor: number,
  width: number,
): {
  readonly prefix: string;
  readonly before: string;
  readonly cursorChar: string;
  readonly after: string;
  readonly suffix: string;
} {
  const safeWidth = Math.max(8, Math.floor(width));
  const safeCursor = Math.min(Math.max(0, Math.floor(cursor)), value.length);
  const contentWidth = value.length <= safeWidth - 2 ? value.length : Math.max(1, safeWidth - 4);
  let adjustedStart = safeCursor === value.length
    ? Math.max(0, value.length - contentWidth)
    : Math.max(0, Math.min(safeCursor - Math.floor(contentWidth / 2), value.length - contentWidth));
  if (safeCursor >= adjustedStart + contentWidth) adjustedStart = safeCursor - contentWidth + 1;
  const adjustedEnd = Math.min(value.length, adjustedStart + contentWidth);
  return {
    prefix: adjustedStart > 0 ? "…" : "",
    before: value.slice(adjustedStart, Math.max(adjustedStart, safeCursor)),
    cursorChar: value[safeCursor] ?? " ",
    after: value.slice(Math.min(value.length, safeCursor + 1), adjustedEnd),
    suffix: adjustedEnd < value.length ? "…" : "",
  };
}

export function renderVisibleUrlWindow(window: ReturnType<typeof visibleUrlWindow>): string {
  return `${window.prefix}${window.before}▌${window.cursorChar}${window.after}${window.suffix}`;
}
