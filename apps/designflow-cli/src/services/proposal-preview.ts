/**
 * Shared bounded proposal review renderer used by BOTH the implementation
 * approval and the correction approval. A human approval gate is only
 * meaningful when the approver can see the exact proposed content: MVP-4M
 * proved that a destructive empty modify looked innocuous when the prompt
 * showed only paths and reasons. Rendering is a pure function of the exact
 * proposal entries handed in, so what is displayed is what the approval
 * hash binds.
 */

export const MAX_PREVIEW_LINES = 120;
export const MAX_PREVIEW_CHARS = 12_000;
/** Diff inputs are line-capped before comparison so rendering stays bounded. */
const MAX_DIFF_INPUT_LINES = 2_000;

export interface ProposalPreviewEntry {
  readonly path: string;
  readonly action: "create" | "modify" | "delete";
  readonly proposedContent?: string;
  /** Trusted current file content, when the caller can resolve it. */
  readonly currentContent?: string;
}

export function splitLines(value: string): string[] {
  // Display-only CRLF normalization: a CRLF/LF-only difference must not
  // render as a whole-file change. The proposal content itself is untouched.
  const lines = value.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(0, MAX_DIFF_INPUT_LINES);
}

/** Minimal LCS line diff — exact, deterministic, no formatting normalization. */
export function diffLines(current: string[], proposed: string[]): string[] {
  const rows = current.length;
  const cols = proposed.length;
  const table: number[] = new Array((rows + 1) * (cols + 1)).fill(0);
  const at = (row: number, col: number): number => table[row * (cols + 1) + col]!;
  for (let row = rows - 1; row >= 0; row -= 1)
    for (let col = cols - 1; col >= 0; col -= 1)
      table[row * (cols + 1) + col] = current[row] === proposed[col] ? at(row + 1, col + 1) + 1 : Math.max(at(row + 1, col), at(row, col + 1));
  const output: string[] = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (current[row] === proposed[col]) { output.push(`  ${current[row]}`); row += 1; col += 1; }
    else if (at(row + 1, col) >= at(row, col + 1)) { output.push(`- ${current[row]}`); row += 1; }
    else { output.push(`+ ${proposed[col]}`); col += 1; }
  }
  while (row < rows) { output.push(`- ${current[row]}`); row += 1; }
  while (col < cols) { output.push(`+ ${proposed[col]}`); col += 1; }
  return output;
}

function bounded(lines: string[], budget: { lines: number; chars: number }): string[] {
  const output: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (output.length >= budget.lines || chars + line.length > budget.chars) {
      const omitted = lines.length - output.length;
      output.push(`[diff truncated — ${omitted} more line${omitted === 1 ? "" : "s"} omitted]`);
      return output;
    }
    output.push(line);
    chars += line.length;
  }
  return output;
}

function changedLineSummary(diff: string[]): string {
  const added = diff.filter((line) => line.startsWith("+ ")).length;
  const removed = diff.filter((line) => line.startsWith("- ")).length;
  return `+${added} / -${removed} line${added + removed === 1 ? "" : "s"}`;
}

export function renderProposalPreview(entries: readonly ProposalPreviewEntry[]): string[] {
  const output: string[] = [];
  const budget = { lines: MAX_PREVIEW_LINES, chars: MAX_PREVIEW_CHARS };
  for (const entry of entries) {
    if (entry.action === "delete") {
      output.push(`DELETE ${entry.path}`, `  current size: ${Buffer.byteLength(entry.currentContent ?? "")} bytes`);
      continue;
    }
    const proposed = entry.proposedContent ?? "";
    if (entry.action === "create") {
      output.push(`--- /dev/null`, `+++ ${entry.path} (create, ${Buffer.byteLength(proposed)} bytes)`);
      output.push(...bounded(splitLines(proposed).map((line) => `+ ${line}`), budget));
      if (proposed.trim().length === 0) output.push(`[warning] proposed content is empty or whitespace-only`);
      continue;
    }
    output.push(`--- ${entry.path}`, `+++ ${entry.path} (modify, ${Buffer.byteLength(proposed)} bytes)`);
    if (entry.currentContent === undefined) {
      output.push(`[current file content unavailable — showing proposed content only]`);
      output.push(...bounded(splitLines(proposed).map((line) => `+ ${line}`), budget));
    } else {
      const diff = diffLines(splitLines(entry.currentContent), splitLines(proposed));
      output.push(`  changed: ${changedLineSummary(diff)}`);
      output.push(...bounded(diff.filter((line) => !line.startsWith("  ")), budget));
    }
    if (proposed.trim().length === 0) output.push(`[warning] proposed content is empty or whitespace-only — this would blank the file`);
  }
  return output;
}
