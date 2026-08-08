import { describe, expect, test } from "bun:test";
import { MAX_PREVIEW_LINES, renderProposalPreview } from "./proposal-preview";

describe("bounded proposal review renderer", () => {
  test("a destructive empty modify visibly shows the removed source and a warning", () => {
    const current = "import X from './x';\nexport default function Page() { return <X />; }\n";
    const lines = renderProposalPreview([{ path: "src/Page.jsx", action: "modify", proposedContent: "", currentContent: current }]);
    expect(lines.join("\n")).toContain("- import X from './x';");
    expect(lines.join("\n")).toContain("- export default function Page() { return <X />; }");
    expect(lines.join("\n")).toContain("changed: +0 / -2 lines");
    expect(lines.join("\n")).toContain("empty or whitespace-only — this would blank the file");
  });

  test("a real modify shows added and removed lines with operation and path", () => {
    const lines = renderProposalPreview([{ path: "src/a.ts", action: "modify", proposedContent: "export const value = 2;\n", currentContent: "export const value = 1;\n" }]);
    const text = lines.join("\n");
    expect(text).toContain("--- src/a.ts");
    expect(text).toContain("+++ src/a.ts (modify");
    expect(text).toContain("- export const value = 1;");
    expect(text).toContain("+ export const value = 2;");
  });

  test("large diffs truncate with an explicit omitted count", () => {
    const current = Array.from({ length: 400 }, (_, index) => `old line ${index}`).join("\n");
    const proposed = Array.from({ length: 400 }, (_, index) => `new line ${index}`).join("\n");
    const lines = renderProposalPreview([{ path: "src/big.ts", action: "modify", proposedContent: proposed, currentContent: current }]);
    expect(lines.some((line) => /\[diff truncated — \d+ more lines omitted\]/.test(line))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(MAX_PREVIEW_LINES + 10);
  });

  test("create shows a bounded content preview with size", () => {
    const lines = renderProposalPreview([{ path: "src/New.jsx", action: "create", proposedContent: "export default () => null;\n" }]);
    const text = lines.join("\n");
    expect(text).toContain("--- /dev/null");
    expect(text).toContain("+++ src/New.jsx (create, 27 bytes)");
    expect(text).toContain("+ export default () => null;");
  });

  test("delete shows the operation and current size without proposed content", () => {
    const lines = renderProposalPreview([{ path: "src/old.ts", action: "delete", currentContent: "export {};\n" }]);
    expect(lines[0]).toBe("DELETE src/old.ts");
    expect(lines[1]).toContain("current size: 11 bytes");
  });

  test("modify without resolvable current content states the limitation honestly", () => {
    const lines = renderProposalPreview([{ path: "src/a.ts", action: "modify", proposedContent: "export {};\n" }]);
    expect(lines.join("\n")).toContain("[current file content unavailable — showing proposed content only]");
  });
});
