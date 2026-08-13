// packages/capabilities/figma-mcp/src/desktop/test/desktop-design-context-parser.test.ts
import { describe, expect, test } from "bun:test";

import { parseDesignContextFacts } from "../../desktop/desktop-design-context-parser";

/**
 * Sanitized fixture mirroring the real Figma Desktop MCP
 * `get_design_context` code shape: generated React+Tailwind with
 * `data-node-id` per element and utility tokens emitted from real node
 * properties. Content is synthetic; token forms are the real contract.
 */
const REAL_SHAPE_CODE = `
function Screen() {
  return (
    <div className="bg-white relative size-full" data-node-id="10:1">
      <div className="absolute bg-[#f9f9f9] border-[#ececec] border-b-2 border-solid content-stretch flex gap-[8px] h-[64px] items-center pl-[24px] rounded-[16px] w-[440px]" data-node-id="10:2">
        <p className="[word-break:break-word] font-[family-name:var(--font,'Poppins:Bold')] leading-[normal] not-italic relative shrink-0 text-[20px] text-black whitespace-nowrap" data-node-id="10:4">{\`Add Transaction \`}</p>
      </div>
      <div className="content-stretch flex flex-col gap-[12px] items-start opacity-[0.5] relative" data-node-id="10:6">
        <p className="font-['Poppins:Medium'] relative shrink-0 text-[24px] w-full" data-node-id="10:7">
          Add New Expense
        </p>
        <div className="relative shrink-0" data-node-id="10:8">
          <p data-node-id="10:9">Nested owner keeps its own text</p>
        </div>
      </div>
    </div>
  );
}`;

describe("parseDesignContextFacts", () => {
  const facts = parseDesignContextFacts(REAL_SHAPE_CODE);

  test("extracts background, border, radius, gap, and layout facts", () => {
    const header = facts.get("10:2")!;
    expect(header.backgroundColor).toBe("#f9f9f9");
    expect(header.borderColor).toBe("#ececec");
    expect(header.cornerRadius).toBe(16);
    expect(header.itemSpacing).toBe(8);
    expect(header.layoutMode).toBe("HORIZONTAL");
  });

  test("extracts text content including template-literal wrapping", () => {
    expect(facts.get("10:4")!.characters).toBe("Add Transaction");
    expect(facts.get("10:7")!.characters).toBe("Add New Expense");
  });

  test("extracts typography facts", () => {
    const title = facts.get("10:4")!;
    expect(title.fontFamily).toBe("Poppins");
    expect(title.fontStyle).toBe("Bold");
    expect(title.fontSizePx).toBe(20);
    expect(title.textColor).toBe("black");

    const subtitle = facts.get("10:7")!;
    expect(subtitle.fontFamily).toBe("Poppins");
    expect(subtitle.fontStyle).toBe("Medium");
  });

  test("extracts column layout and opacity", () => {
    const column = facts.get("10:6")!;
    expect(column.layoutMode).toBe("VERTICAL");
    expect(column.opacity).toBe(0.5);
    expect(column.itemSpacing).toBe(12);
  });

  test("does not attribute nested element text to the containing node", () => {
    expect(facts.get("10:8")).toBeUndefined();
    expect(facts.get("10:9")!.characters).toBe("Nested owner keeps its own text");
  });

  test("returns an empty map for content with no recognized tokens", () => {
    expect(parseDesignContextFacts("just some prose with no markup").size).toBe(0);
    expect(parseDesignContextFacts("").size).toBe(0);
  });
});
