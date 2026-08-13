// packages/agents/src/specification/evidence/specification-evidence-bundle.test.ts
//
// DF-SPEC-05: the deterministic evidence compiler. The Specification AI stops
// receiving the raw `FigmaSourceSnapshot` and receives a compact bundle
// instead — so the load-bearing property is semantic equivalence, not size:
// every fact the desired Spendly specification needs must survive
// compaction, while shared component styling, empty transport bags and
// repeated raw values are sent once or not at all.
import { describe, expect, test } from "bun:test";
import {
  figmaSourceSnapshotSchema,
  type FigmaSourceSnapshot,
  type SpecializedAgentContext,
  type TraceEvidenceMetrics,
} from "@designflow/sdk";

import {
  compileSpecificationEvidenceBundle,
  estimateTokens,
} from "./specification-evidence-bundle";
import {
  figmaSpecificationAgentManifest,
  modelFigmaSpecificationStrategy,
} from "../legacy/figma-specification-agent";

const FIELD_STYLE = {
  cornerRadius: 10,
  fills: [{ type: "SOLID", color: { r: 0.972, g: 0.972, b: 0.972 } }],
  strokes: [{ type: "SOLID", color: { r: 0.827, g: 0.827, b: 0.827 } }],
} as const;

/**
 * A DF-SPEC-04-shaped snapshot: the six Text fields are INSTANCE nodes that
 * really do carry their descendants (exact copy + icon slots), the way the
 * desktop adapter now normalizes them.
 */
function textField(
  id: string,
  name: string,
  slots: readonly { id: string; name: string; text?: string }[],
): Record<string, unknown>[] {
  return [
    {
      id,
      name,
      type: "INSTANCE",
      parentId: "1:40",
      componentId: "C:textfield",
      childIds: slots.map((slot) => slot.id),
      absoluteBoundingBox: { x: 24, y: 0, width: 392, height: 56 },
      layoutMode: "HORIZONTAL",
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      ...FIELD_STYLE,
    },
    ...slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      type: slot.text !== undefined ? "TEXT" : "FRAME",
      parentId: id,
      ...(slot.text !== undefined ? { characters: slot.text } : {}),
      properties: { typography: { fontFamily: "Poppins", fontStyle: "Regular", fontSize: 16 } },
    })),
  ];
}

const SPENDLY: FigmaSourceSnapshot = figmaSourceSnapshotSchema.parse({
  source: {
    designFile: "https://www.figma.com/design/E958/Spendly?node-id=1026-6098",
    nodeIds: ["1:1"],
    resolvedFrames: [{ id: "1:1", name: "Add Transaction", path: ["Add Transaction"] }],
  },
  capabilities: { componentsAvailable: true, variablesAvailable: true },
  nodes: [
    { id: "1:1", name: "Add Transaction", type: "FRAME", childIds: ["1:10", "1:20", "1:40", "1:50", "1:60", "1:70"], absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 1092 }, layoutMode: "VERTICAL", itemSpacing: 24, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] },
    { id: "1:10", name: "App header", type: "FRAME", parentId: "1:1", childIds: ["1:11"], layoutMode: "HORIZONTAL" },
    { id: "1:11", name: "Title", type: "TEXT", parentId: "1:10", characters: "Add Transaction" },
    { id: "1:20", name: "Tabs", type: "FRAME", parentId: "1:1", childIds: ["1:21", "1:22"], layoutMode: "HORIZONTAL", itemSpacing: 8 },
    { id: "1:21", name: "Expense tab", type: "TEXT", parentId: "1:20", characters: "Expense", variantProperties: { State: "Selected" } },
    { id: "1:22", name: "Income tab", type: "TEXT", parentId: "1:20", characters: "Income", variantProperties: { State: "Default" } },
    { id: "1:40", name: "Add Expense form", type: "FRAME", parentId: "1:1", childIds: ["1:41", "1:42", "1:43", "1:44", "1:45", "1:46"], layoutMode: "VERTICAL", itemSpacing: 16 },
    ...textField("1:41", "Amount field", [
      { id: "1:41a", name: "Placeholder", text: "Enter amount" },
      { id: "1:41b", name: "Dollar", text: "Dollar" },
    ]),
    ...textField("1:42", "Title field", [
      { id: "1:42a", name: "Leading icon" },
      { id: "1:42b", name: "Placeholder", text: "Add a title" },
    ]),
    ...textField("1:43", "Card selector", [
      { id: "1:43a", name: "Card icon" },
      { id: "1:43b", name: "Placeholder", text: "Select your card" },
      { id: "1:43c", name: "Chevron" },
    ]),
    ...textField("1:44", "Category selector", [{ id: "1:44a", name: "Placeholder", text: "Select or add categories" }]),
    ...textField("1:45", "Payee field", [
      { id: "1:45a", name: "Placeholder", text: "Who did you pay for?" },
      { id: "1:45b", name: "Hint", text: "Optional" },
    ]),
    ...textField("1:46", "Date field", [{ id: "1:46a", name: "Value", text: "1404/04/24" }]),
    { id: "1:50", name: "Add Expense button", type: "INSTANCE", parentId: "1:1", componentId: "C:button", childIds: ["1:50a"], absoluteBoundingBox: { x: 24, y: 700, width: 392, height: 62 }, cornerRadius: 12, fills: [{ type: "SOLID", color: { r: 0.882, g: 0.882, b: 0.882 } }] },
    { id: "1:50a", name: "Label", type: "TEXT", parentId: "1:50", characters: "Fill the information" },
    { id: "1:60", name: "Expense History", type: "FRAME", parentId: "1:1", childIds: ["1:62", "1:63", "1:61"], layoutMode: "VERTICAL" },
    { id: "1:62", name: "History month", type: "TEXT", parentId: "1:60", characters: "May 2024" },
    { id: "1:63", name: "History heading", type: "TEXT", parentId: "1:60", characters: "Expense History" },
    { id: "1:61", name: "History card", type: "INSTANCE", parentId: "1:60", componentId: "C:historycard", childIds: ["1:61a", "1:61b"], strokes: [{ type: "SOLID", color: { r: 0.905, g: 0.905, b: 0.905 } }], cornerRadius: 10 },
    { id: "1:61a", name: "Card title", type: "TEXT", parentId: "1:61", characters: "Deposit from Alex" },
    { id: "1:61b", name: "Card amount", type: "TEXT", parentId: "1:61", characters: "-5,000 T" },
    { id: "1:70", name: "Bottom navigation", type: "INSTANCE", parentId: "1:1", componentId: "C:nav", childIds: ["1:70a", "1:70b", "1:70c", "1:70d", "1:70e"], variantProperties: { variant: "Expenses" } },
    { id: "1:70a", name: "Item", type: "TEXT", parentId: "1:70", characters: "Add" },
    { id: "1:70b", name: "Item", type: "TEXT", parentId: "1:70", characters: "Report" },
    { id: "1:70c", name: "Item", type: "TEXT", parentId: "1:70", characters: "Invest" },
    { id: "1:70d", name: "Item", type: "TEXT", parentId: "1:70", characters: "Loan" },
    { id: "1:70e", name: "Item", type: "TEXT", parentId: "1:70", characters: "Setting" },
  ],
  variables: [{ name: "Color/Surface/field", value: "#F8F8F8", type: "COLOR" }],
  components: [
    { id: "C:textfield", name: "TextField" },
    { id: "1:41", name: "TextField" },
    { id: "1:42", name: "TextField" },
    { id: "1:43", name: "TextField" },
    { id: "1:44", name: "TextField" },
    { id: "1:45", name: "TextField" },
    { id: "1:46", name: "TextField" },
    { id: "1:50", name: "Button" },
    { id: "1:61", name: "HistoryCard" },
    { id: "1:70", name: "NavigationMenuV3" },
  ],
  assets: [{ id: "A:calendar", name: "Calendar icon", type: "icon", reference: "asset://calendar" }],
});

const bundle = compileSpecificationEvidenceBundle(SPENDLY);
const serialized = JSON.stringify(bundle);

describe("Spendly semantic equivalence — nothing the specification needs is compacted away", () => {
  test("screen, header and tab evidence survive", () => {
    expect(bundle.screen?.size).toBe("440x1092");
    expect(bundle.screen?.name).toBe("Add Transaction");
    expect(serialized).toContain("Add Transaction");
    for (const copy of ["Expense", "Income"]) {
      expect(bundle.elements.some((element) => element.text === copy)).toBe(true);
    }
    const selected = bundle.elements.find((element) => element.nodeId === "1:21");
    expect(bundle.elements.find((element) => element.nodeId === "1:22")).toBeDefined();
    expect(selected).toBeDefined();
  });

  test("six TextField uses keep their exact contents, slots and shared styling", () => {
    const fields = bundle.instances.filter((instance) => instance.componentRef === "TextField");
    expect(fields).toHaveLength(6);

    const contents = fields.flatMap((field) => field.contents.map((slot) => slot.text));
    for (const copy of [
      "Enter amount", "Dollar", "Add a title", "Select your card",
      "Select or add categories", "Who did you pay for?", "Optional", "1404/04/24",
    ]) {
      expect(contents).toContain(copy);
    }
    // icon/leading/trailing slots are named, not dropped
    const slotNames = fields.flatMap((field) => field.contents.map((slot) => slot.name));
    for (const slot of ["Leading icon", "Card icon", "Chevron"]) {
      expect(slotNames).toContain(slot);
    }

    // shared base style is stated once on the component, not per instance
    const component = bundle.components.find((entry) => entry.ref === "TextField")!;
    expect(component.instanceCount).toBe(6);
    expect(component.sharedSize).toBe("392x56");
    expect(component.sharedStyle?.radius).toBe("10px");
    expect(component.sharedStyle?.background).toBe("#F8F8F8");
    expect(component.sharedStyle?.border).toBe("#D3D3D3");
    expect(component.sharedLayout).toContain("padding 16/16/16/16");
    expect(fields.every((field) => field.style === undefined && field.size === undefined)).toBe(true);
  });

  test("button, history and navigation evidence survive with their real values", () => {
    const button = bundle.instances.find((instance) => instance.nodeId === "1:50")!;
    expect(button.contents.map((slot) => slot.text)).toContain("Fill the information");
    expect(button.size ?? bundle.components.find((entry) => entry.ref === "Button")?.sharedSize).toBe("392x62");

    for (const copy of ["May 2024", "Expense History"]) {
      expect(bundle.elements.some((element) => element.text === copy)).toBe(true);
    }
    const card = bundle.instances.find((instance) => instance.nodeId === "1:61")!;
    expect(card.contents.map((slot) => slot.text)).toContain("Deposit from Alex");

    const nav = bundle.instances.find((instance) => instance.nodeId === "1:70")!;
    expect(nav.propertyValues).toEqual({ variant: "Expenses" });
    for (const item of ["Add", "Report", "Invest", "Loan", "Setting"]) {
      expect(nav.contents.map((slot) => slot.text)).toContain(item);
    }
  });

  test("foundations, assets and component identity are deduplicated but complete", () => {
    expect(bundle.foundations.radii).toContain("10px");
    expect(bundle.foundations.colors).toContain("#F8F8F8");
    expect(bundle.foundations.variables.map((variable) => variable.name)).toContain("Color/Surface/field");
    // one occurrence per distinct value, not one per node
    expect(new Set(bundle.foundations.colors).size).toBe(bundle.foundations.colors.length);
    expect(bundle.assets.map((asset) => asset.name)).toContain("Calendar icon");
    expect(bundle.components.map((component) => component.ref).sort()).toEqual([
      "Button", "HistoryCard", "NavigationMenuV3", "TextField",
    ]);
  });

  test("every element and instance stays traceable to a real Figma node id", () => {
    const known = new Set(SPENDLY.nodes.map((node) => node.id));
    const referenced = [
      ...bundle.elements.map((element) => element.nodeId),
      ...bundle.instances.map((instance) => instance.nodeId),
      ...bundle.instances.flatMap((instance) => instance.contents.map((slot) => slot.nodeId)),
    ];
    expect(referenced.filter((id) => !known.has(id))).toEqual([]);
  });
});

describe("compaction metrics", () => {
  test("the bundle is materially smaller than the raw snapshot and reports it", () => {
    const metrics = bundle.metrics;
    expect(metrics.snapshotNodeCount).toBe(SPENDLY.nodes.length);
    expect(metrics.bundleInstanceCount).toBe(9);
    expect(metrics.bundleComponentCount).toBe(4);
    expect(metrics.bundleBytes).toBeLessThan(metrics.snapshotBytes);
    expect(metrics.reductionPercent).toBeGreaterThan(20);
    expect(estimateTokens(metrics.bundleBytes)).toBeLessThan(estimateTokens(metrics.snapshotBytes));
  });

  test("no empty transport bags or duplicated component anatomy reach the model", () => {
    expect(serialized).not.toContain('"exportSettings"');
    expect(serialized).not.toContain('"fills":[]');
    expect(serialized).not.toContain('"properties":{}');
    // the shared TextField anatomy appears once, on the component
    const anatomyOccurrences = serialized.split('"anatomy"').length - 1;
    expect(anatomyOccurrences).toBe(bundle.components.length);
  });
});

describe("sparse and impoverished evidence", () => {
  test("a sparse snapshot compiles to a small truthful bundle without invention", () => {
    const sparse = figmaSourceSnapshotSchema.parse({
      source: {
        designFile: "https://www.figma.com/design/E958/Spendly?node-id=9-9",
        nodeIds: ["9:9"],
        resolvedFrames: [{ id: "9:9", name: "Bare", path: ["Bare"] }],
      },
      nodes: [{ id: "9:9", name: "Bare", type: "FRAME" }],
    });
    const compiled = compileSpecificationEvidenceBundle(sparse);
    expect(compiled.elements).toHaveLength(1);
    expect(compiled.components).toEqual([]);
    expect(compiled.instances).toEqual([]);
    expect(compiled.foundations.colors).toEqual([]);
    expect(JSON.stringify(compiled)).not.toContain("Enter amount");
  });

  test("the model input is the bundle and still carries rich instance evidence (no 40-node regression)", async () => {
    let captured = "";
    const context: SpecializedAgentContext = {
      tools: { call: async () => { throw new Error("no tools"); } },
      metadata: {},
      signal: new AbortController().signal,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      model: {
        generate: async (request: { messages: readonly { content: string }[] }) => {
          captured = request.messages.map((message) => message.content).join("\n");
          throw new Error("stop after capture");
        },
      },
    } as never;

    await modelFigmaSpecificationStrategy(
      { agentId: "figma-specification-agent", objective: "specify", input: { figmaSnapshot: SPENDLY }, attempt: 1 },
      context,
      figmaSpecificationAgentManifest,
    ).catch(() => undefined);

    for (const evidence of [
      "Enter amount", "Add a title", "Select your card", "Select or add categories",
      "Who did you pay for?", "Optional", "1404/04/24", "Fill the information",
      "Add", "Report", "Invest", "Loan", "Setting", "Expenses",
    ]) {
      expect(captured).toContain(evidence);
    }
    // the bundle, not the raw snapshot
    expect(captured).toContain('"componentRef"');
    expect(captured).not.toContain('"exportSettings"');
  });

  test("the agent reports sanitized model-input metrics, never the evidence itself", async () => {
    const reported: TraceEvidenceMetrics[] = [];
    const context: SpecializedAgentContext = {
      tools: { call: async () => { throw new Error("no tools"); } },
      metadata: {},
      signal: new AbortController().signal,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      reportEvidenceMetrics: (metrics) => reported.push(metrics),
      model: { generate: async () => { throw new Error("stop"); } },
    } as never;

    await modelFigmaSpecificationStrategy(
      { agentId: "figma-specification-agent", objective: "specify", input: { figmaSnapshot: SPENDLY }, attempt: 1 },
      context,
      figmaSpecificationAgentManifest,
    ).catch(() => undefined);

    expect(reported).toHaveLength(1);
    expect(reported[0]?.snapshotNodeCount).toBe(SPENDLY.nodes.length);
    expect(reported[0]?.bundleInstanceCount).toBe(9);
    expect(Object.values(reported[0] ?? {}).every((value) => typeof value === "number")).toBe(true);
  });
});
