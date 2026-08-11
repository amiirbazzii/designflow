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
  const safeWidth = Math.max(12, width);
  const hasPrefix = cursor > safeWidth - 2;
  const hasSuffix = value.length - cursor > safeWidth - 2;
  const start = hasPrefix ? Math.max(0, cursor - Math.floor(safeWidth / 2)) : 0;
  const end = hasSuffix ? Math.min(value.length, start + safeWidth) : value.length;
  const adjustedStart = Math.max(0, end === value.length ? value.length - safeWidth : start);
  const adjustedEnd = Math.min(value.length, adjustedStart + safeWidth);
  return {
    prefix: adjustedStart > 0 ? "…" : "",
    before: value.slice(adjustedStart, Math.max(adjustedStart, cursor)),
    cursorChar: value[cursor] ?? " ",
    after: value.slice(Math.min(value.length, cursor + 1), adjustedEnd),
    suffix: adjustedEnd < value.length ? "…" : "",
  };
}
