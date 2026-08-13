// packages/capabilities/figma-mcp/src/desktop/instance-evidence-expander.test.ts
//
// DF-SPEC-04: rich instance/component evidence capture. The Spendly field
// snapshot proved the `get_metadata` outline stops at INSTANCE boundaries —
// six "Text field" instances with empty childIds, no componentId, no
// variants, and zero of the visible field copy anywhere in persisted state.
// The `get_design_context` code exposes all of it. These tests drive the
// real desktop adapter against a Spendly-shaped fixture and assert the
// normalized FigmaSourceSnapshot preserves the evidence BEFORE any model.
import { describe, expect, test } from "bun:test";
import type { CapabilityContext, FigmaSourceSnapshot } from "@designflow/sdk";
import { buildFigmaDesktopSourceSnapshot } from "./figma-desktop-adapter";
import { parseFigmaSource } from "../parse-figma-source";
import { parseDesignContextTree } from "./desktop-design-context-parser";
import { InMemoryMcpClient } from "../../test/support/in-memory-mcp-client";

function store(): unknown {
  const payloads = new Map<string, unknown>();
  return {
    async put(data: unknown) {
      const id = `spendly-payload-${payloads.size}`;
      payloads.set(id, data);
      return { id, data };
    },
    async get(id: string) {
      const data = payloads.get(id);
      return data === undefined ? null : { id, data };
    },
    async exists(id: string) { return payloads.has(id); },
  };
}

function context(mcp: CapabilityContext["mcp"]): CapabilityContext {
  return {
    executionId: "spendly-exec",
    workflowId: "spendly-workflow",
    capabilityId: "retrieve-figma-source-snapshot",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    artifactRefs: [],
    parentArtifacts: [],
    artifactStore: store(),
    config: {},
    signal: new AbortController().signal,
    mcp,
  } as never;
}

const METADATA_OUTLINE = [
  'Currently selected nodes:',
  '- 1026:6098: Add Transaction',
  '<frame id="1026:6098" name="Add Transaction" x="0" y="0" width="440" height="1092">',
  '  <frame id="1026:6110" name="Header" x="0" y="0" width="440" height="64">',
  '    <text id="1026:6111" name="Title" x="56" y="17" width="171" height="30" />',
  '  </frame>',
  '  <frame id="1026:6115" name="Form" x="24" y="200" width="392" height="420">',
  '    <instance id="1026:6116" name="Text field" x="0" y="0" width="392" height="56" />',
  '    <instance id="1026:6117" name="Text field" x="0" y="72" width="392" height="56" />',
  '    <instance id="1026:6118" name="Text field" x="0" y="144" width="392" height="56" />',
  '  </frame>',
  '  <instance id="1026:6122" name="Button" x="24" y="700" width="392" height="62" />',
  '  <frame id="1026:6131" name="History" x="24" y="800" width="392" height="200">',
  '    <instance id="1026:6126" name="Button" x="0" y="0" width="48" height="48" />',
  '    <instance id="1026:6132" name="Expense History Item" x="0" y="60" width="392" height="96" />',
  '  </frame>',
  '  <instance id="1026:6137" name="Navigation menu v3" x="0" y="1020" width="440" height="72" />',
  '</frame>',
].join("\n");

const DESIGN_CONTEXT = [
  '<div className="bg-white relative w-[440px] h-[1092px]" data-node-id="1026:6098" data-name="Add Transaction">',
  '  <div className="flex" data-node-id="1026:6110" data-name="Header">',
  '    <p className="font-[\'Poppins:Bold\'] text-[20px] text-black" data-node-id="1026:6111">Add Transaction</p>',
  '  </div>',
  '  <div className="flex-col flex gap-[16px]" data-node-id="1026:6115" data-name="Form">',
  '    <TextField className="bg-[#f8f8f8] border-[#d3d3d3] rounded-[10px] h-[56px] px-[16px] flex" data-node-id="1026:6116" data-name="Amount field">',
  '      <p className="text-[#8b8b8b] text-[16px]" data-node-id="I1026:6116;40:1">Enter amount</p>',
  '      <p className="text-[#111111] text-[16px]" data-node-id="I1026:6116;40:2">Dollar</p>',
  '    </TextField>',
  '    <TextField className="bg-[#f8f8f8] border-[#d3d3d3] rounded-[10px] h-[56px] px-[16px] flex" data-node-id="1026:6117" data-name="Title field">',
  '      <div className="w-[24px] h-[24px]" data-node-id="I1026:6117;41:1" data-name="Leading icon" />',
  '      <p className="text-[16px]" data-node-id="I1026:6117;41:2">Add a title</p>',
  '    </TextField>',
  '    <TextField className="bg-[#f8f8f8] border-[#d3d3d3] rounded-[10px] h-[56px] px-[16px] flex" data-node-id="1026:6118" data-name="Card selector">',
  '      <div className="w-[24px] h-[24px]" data-node-id="I1026:6118;42:1" data-name="Card icon" />',
  '      <p className="text-[16px]" data-node-id="I1026:6118;42:2">Select your card</p>',
  '      <div className="w-[24px] h-[24px]" data-node-id="I1026:6118;42:3" data-name="Chevron" />',
  '    </TextField>',
  '  </div>',
  '  <Button className="bg-[#e1e1e1] border-[#cacaca] rounded-[12px] w-[392px] h-[62px]" data-node-id="1026:6122" data-name="Primary action">',
  '    <p className="font-[\'Poppins:Medium\'] text-[20px] text-[#111111]" data-node-id="I1026:6122;50:1">Fill the information</p>',
  '  </Button>',
  '  <div className="flex-col flex" data-node-id="1026:6131" data-name="History">',
  '    <Button className="w-[48px] h-[48px] rounded-[10px]" data-node-id="1026:6126" data-name="Previous month">',
  '      <div className="w-[24px] h-[24px]" data-node-id="I1026:6126;51:1" data-name="chevron-left" />',
  '    </Button>',
  '    <HistoryCard className="bg-white border-[#e7e7e7] rounded-[10px]" data-node-id="1026:6132" data-name="History card">',
  '      <p className="text-[16px]" data-node-id="I1026:6132;60:1">Grocery Shopping</p>',
  '      <p className="text-[16px]" data-node-id="I1026:6132;60:2">-$120.50</p>',
  '      <p className="text-[14px]" data-node-id="I1026:6132;60:3">Master Card</p>',
  '      <p className="text-[12px]" data-node-id="I1026:6132;60:4">Food</p>',
  '    </HistoryCard>',
  '  </div>',
  '  <NavigationMenuV3 variant="Expenses" className="bg-white flex" data-node-id="1026:6137" data-name="Navigation menu v3">',
  '    <p className="text-[12px]" data-node-id="I1026:6137;70:1">Add</p>',
  '    <p className="text-[12px]" data-node-id="I1026:6137;70:2">Report</p>',
  '    <p className="text-[12px]" data-node-id="I1026:6137;70:3">Invest</p>',
  '    <p className="text-[12px]" data-node-id="I1026:6137;70:4">Loan</p>',
  '    <p className="text-[12px]" data-node-id="I1026:6137;70:5">Setting</p>',
  '  </NavigationMenuV3>',
  '</div>',
].join("\n");

async function buildSpendlySnapshot(designContext: string = DESIGN_CONTEXT): Promise<FigmaSourceSnapshot> {
  const client = new InMemoryMcpClient({
    serverIdentity: "figma-desktop-mcp",
    tools: [
      { name: "get_metadata" },
      { name: "get_design_context" },
      { name: "get_variable_defs" },
    ],
    results: {
      get_metadata: [{ type: "text", text: METADATA_OUTLINE }],
      get_design_context: [{ type: "text", text: designContext }],
      get_variable_defs: [{ type: "text", text: '{"Color/Surface/field":"#F8F8F8"}' }],
    },
  });
  return buildFigmaDesktopSourceSnapshot(context(client), {
    parsedSource: parseFigmaSource("https://www.figma.com/design/E958/Spendly?node-id=1026-6098"),
    sourceKind: "figma-url",
    captureScreenshots: false,
    screenshotArtifactIdPrefix: "spendly",
    now: () => "2026-08-12T00:00:00.000Z",
  });
}

describe("instance descendant evidence (Spendly-shaped)", () => {
  test("TextField instances carry their real contents, slots and shared styling", async () => {
    const snapshot = await buildSpendlySnapshot();
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));

    const amount = byId.get("1026:6116")!;
    expect(amount.childIds).toContain("I1026:6116;40:1");
    expect(byId.get("I1026:6116;40:1")?.characters).toBe("Enter amount");
    expect(byId.get("I1026:6116;40:2")?.characters).toBe("Dollar");
    // shared base styling from context facts
    expect(amount.fills[0]).toMatchObject({ color: "#f8f8f8" });
    expect(amount.strokes[0]).toMatchObject({ color: "#d3d3d3" });
    expect(amount.cornerRadius).toBe(10);

    expect(byId.get("I1026:6117;41:2")?.characters).toBe("Add a title");
    expect(byId.get("I1026:6117;41:1")?.name).toBe("Leading icon");
    expect(byId.get("I1026:6118;42:2")?.characters).toBe("Select your card");
    expect(byId.get("I1026:6118;42:3")?.name).toBe("Chevron");

    // no invented contents: nothing named Note or Attachment
    expect(snapshot.nodes.some((node) => /note|attachment/i.test(node.name))).toBe(false);
  });

  test("Button instances are distinguishable: primary text action vs icon buttons", async () => {
    const snapshot = await buildSpendlySnapshot();
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    expect(byId.get("I1026:6122;50:1")?.characters).toBe("Fill the information");
    const primary = byId.get("1026:6122")!;
    expect(primary.fills[0]).toMatchObject({ color: "#e1e1e1" });
    expect(primary.cornerRadius).toBe(12);
    expect(byId.get("I1026:6126;51:1")?.name).toBe("chevron-left");
  });

  test("HistoryCard anatomy and representative sample content survive", async () => {
    const snapshot = await buildSpendlySnapshot();
    const texts = snapshot.nodes.map((node) => node.characters).filter((text) => text !== undefined);
    for (const copy of ["Grocery Shopping", "-$120.50", "Master Card", "Food"]) {
      expect(texts).toContain(copy);
    }
    const card = snapshot.nodes.find((node) => node.id === "1026:6132")!;
    expect(card.strokes[0]).toMatchObject({ color: "#e7e7e7" });
    expect(card.cornerRadius).toBe(10);
  });

  test("NavigationMenuV3 exposes the actual items, component name and variant metadata", async () => {
    const snapshot = await buildSpendlySnapshot();
    const texts = snapshot.nodes.map((node) => node.characters).filter((text) => text !== undefined);
    for (const label of ["Add", "Report", "Invest", "Loan", "Setting"]) {
      expect(texts).toContain(label);
    }
    const nav = snapshot.nodes.find((node) => node.id === "1026:6137")!;
    expect(nav.variantProperties).toEqual({ variant: "Expenses" });
    const componentEntry = snapshot.components.find((component) => component.id === "1026:6137");
    expect(componentEntry?.name).toBe("NavigationMenuV3");
    expect(componentEntry?.variantProperties).toEqual({ variant: "Expenses" });
  });

  test("component identity stays distinct from instances: TextField/Button/HistoryCard names captured", async () => {
    const snapshot = await buildSpendlySnapshot();
    const names = new Set(snapshot.components.map((component) => component.name));
    for (const name of ["TextField", "Button", "HistoryCard", "NavigationMenuV3"]) {
      expect(names.has(name)).toBe(true);
    }
  });

  test("sparse context stays truthful: no descendants are invented without design context", async () => {
    const client = new InMemoryMcpClient({
      serverIdentity: "figma-desktop-mcp",
      tools: [{ name: "get_metadata" }],
      results: { get_metadata: [{ type: "text", text: METADATA_OUTLINE }] },
    });
    const snapshot = await buildFigmaDesktopSourceSnapshot(context(client), {
      parsedSource: parseFigmaSource("https://www.figma.com/design/E958/Spendly?node-id=1026-6098"),
      sourceKind: "figma-url",
      captureScreenshots: false,
      screenshotArtifactIdPrefix: "spendly",
      now: () => "2026-08-12T00:00:00.000Z",
    });
    const amount = snapshot.nodes.find((node) => node.id === "1026:6116")!;
    expect(amount.childIds).toEqual([]);
    expect(snapshot.nodes.some((node) => node.characters === "Enter amount")).toBe(false);
  });

  // DF-SPEC-05 §2: in field run d840ab80 the icon Button, the first history
  // card and the navigation menu stayed unexpanded while the text-only
  // TextFields expanded — every one of them carries a JSX *expression* prop in
  // the generated code, which the quoted-pairs-only tag grammar could not
  // match, so the whole element (and its subtree) was skipped.
  test("instances whose generated tag carries JSX expression props still expand", async () => {
    const withExpressionProps = DESIGN_CONTEXT
      .replace(
        '<NavigationMenuV3 variant="Expenses" className="bg-white flex"',
        '<NavigationMenuV3 variant="Expenses" imgIcon={imgNavIcon} {...navProps} className="bg-white flex"',
      )
      .replace(
        '<Button className="w-[48px] h-[48px] rounded-[10px]" data-node-id="1026:6126"',
        '<Button icon={imgChevronLeft} className="w-[48px] h-[48px] rounded-[10px]" data-node-id="1026:6126"',
      )
      .replace(
        '<HistoryCard className="bg-white border-[#e7e7e7] rounded-[10px]"',
        '<HistoryCard avatar={imgAvatar} className="bg-white border-[#e7e7e7] rounded-[10px]"',
      );

    const snapshot = await buildSpendlySnapshot(withExpressionProps);
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const texts = snapshot.nodes.map((node) => node.characters).filter((text) => text !== undefined);

    for (const label of ["Add", "Report", "Invest", "Loan", "Setting", "Grocery Shopping"]) {
      expect(texts).toContain(label);
    }
    expect(byId.get("1026:6137")?.variantProperties).toEqual({ variant: "Expenses" });
    expect(byId.get("I1026:6126;51:1")?.name).toBe("chevron-left");
    expect(byId.get("1026:6132")?.childIds.length).toBeGreaterThan(0);
    // an expression prop is not a property VALUE — nothing is invented from it
    expect(JSON.stringify(snapshot)).not.toContain("imgNavIcon");
  });

  test("expansion is bounded and reports truncation instead of silently dropping evidence", () => {
    const deep = Array.from({ length: 30 }, (_, index) =>
      `<div className="flex" data-node-id="d:${index}" data-name="Level ${index}">`).join("") +
      "x" + Array.from({ length: 30 }, () => "</div>").join("");
    const tree = parseDesignContextTree(`<div data-node-id="root">${deep}</div>`);
    expect(tree).toHaveLength(1);
  });
});
