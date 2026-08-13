// packages/agents/test/fixtures/spendly-blueprint-snapshot.ts
//
// The Spendly "Add Transaction" screen, shaped exactly as the Figma Desktop
// adapter normalizes it after DF-SPEC-04: component instances really do carry
// their descendants (exact copy, icon slots, variant properties), which is
// what makes it a meaningful fixture for the deterministic Blueprint compiler.
import { figmaSourceSnapshotSchema, type FigmaSourceSnapshot } from "@designflow/sdk";

const FIELD_STYLE = {
  cornerRadius: 10,
  fills: [{ type: "SOLID", color: { r: 0.972, g: 0.972, b: 0.972 } }],
  strokes: [{ type: "SOLID", color: { r: 0.827, g: 0.827, b: 0.827 } }],
} as const;

const TYPOGRAPHY = { typography: { fontFamily: "Poppins", fontStyle: "Regular", fontSize: 16 } };

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
      itemSpacing: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      ...FIELD_STYLE,
    },
    ...slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      type: slot.text !== undefined ? "TEXT" : "FRAME",
      parentId: id,
      ...(slot.text !== undefined ? { characters: slot.text } : {}),
      ...(slot.text !== undefined ? { fills: [{ type: "SOLID", color: { r: 0.44, g: 0.44, b: 0.44 } }] } : {}),
      properties: TYPOGRAPHY,
    })),
  ];
}

export const SPENDLY_SNAPSHOT: FigmaSourceSnapshot = figmaSourceSnapshotSchema.parse({
  source: {
    designFile: "https://www.figma.com/design/E958/Spendly?node-id=1026-6098",
    fileKey: "E958ARSSBoJjblLhxZQVSU",
    nodeIds: ["1:1"],
    resolvedFrames: [{ id: "1:1", name: "Add Transaction", path: ["Add Transaction"] }],
  },
  capabilities: { componentsAvailable: true, variablesAvailable: true, screenshotsAvailable: true },
  nodes: [
    { id: "1:1", name: "Add Transaction", type: "FRAME", childIds: ["1:10", "1:20", "1:40", "1:50", "1:60", "1:70"], absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 1092 }, layoutMode: "VERTICAL", itemSpacing: 24, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] },

    { id: "1:10", name: "Header", type: "FRAME", parentId: "1:1", childIds: ["1:11", "1:12"], absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 64 }, layoutMode: "HORIZONTAL", itemSpacing: 8 },
    { id: "1:11", name: "Title", type: "TEXT", parentId: "1:10", characters: "Add Transaction", properties: { typography: { fontFamily: "Poppins", fontStyle: "Bold", fontSize: 20 } }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] },
    { id: "1:12", name: "chevron-left", type: "FRAME", parentId: "1:10", absoluteBoundingBox: { x: 16, y: 20, width: 24, height: 24 } },

    { id: "1:20", name: "Tabs", type: "FRAME", parentId: "1:1", childIds: ["1:21", "1:22"], layoutMode: "HORIZONTAL", itemSpacing: 8 },
    { id: "1:21", name: "Expense tab", type: "TEXT", parentId: "1:20", characters: "Expense", variantProperties: { State: "Selected" }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] },
    { id: "1:22", name: "Income tab", type: "TEXT", parentId: "1:20", characters: "Income", variantProperties: { State: "Default" }, fills: [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.55 } }] },

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

    { id: "1:50", name: "Primary action", type: "INSTANCE", parentId: "1:1", componentId: "C:button", childIds: ["1:50a"], absoluteBoundingBox: { x: 24, y: 700, width: 392, height: 62 }, cornerRadius: 12, fills: [{ type: "SOLID", color: { r: 0.882, g: 0.882, b: 0.882 } }], strokes: [{ type: "SOLID", color: { r: 0.792, g: 0.792, b: 0.792 } }], effects: [{ type: "DROP_SHADOW", radius: 4, color: { r: 0, g: 0, b: 0 } }] },
    { id: "1:50a", name: "Label", type: "TEXT", parentId: "1:50", characters: "Fill the information", properties: { typography: { fontFamily: "Poppins", fontStyle: "Medium", fontSize: 20 } } },

    { id: "1:60", name: "Expense History", type: "FRAME", parentId: "1:1", childIds: ["1:62", "1:63", "1:61"], layoutMode: "VERTICAL", itemSpacing: 12 },
    { id: "1:62", name: "History month", type: "TEXT", parentId: "1:60", characters: "May 2024" },
    { id: "1:63", name: "History heading", type: "TEXT", parentId: "1:60", characters: "Expense History" },
    { id: "1:61", name: "History card", type: "INSTANCE", parentId: "1:60", componentId: "C:historycard", childIds: ["1:61a", "1:61b", "1:61c"], strokes: [{ type: "SOLID", color: { r: 0.905, g: 0.905, b: 0.905 } }], cornerRadius: 10 },
    { id: "1:61a", name: "Card title", type: "TEXT", parentId: "1:61", characters: "Deposit from Alex" },
    { id: "1:61b", name: "Card amount", type: "TEXT", parentId: "1:61", characters: "-5,000 T" },
    { id: "1:61c", name: "Card payment", type: "TEXT", parentId: "1:61", characters: "Bank Deposit" },

    { id: "1:70", name: "Bottom navigation", type: "INSTANCE", parentId: "1:1", componentId: "C:nav", childIds: ["1:70a", "1:70b", "1:70c", "1:70d", "1:70e"], variantProperties: { variant: "Expenses" } },
    { id: "1:70a", name: "Item", type: "TEXT", parentId: "1:70", characters: "Add" },
    { id: "1:70b", name: "Item", type: "TEXT", parentId: "1:70", characters: "Report" },
    { id: "1:70c", name: "Item", type: "TEXT", parentId: "1:70", characters: "Invest" },
    { id: "1:70d", name: "Item", type: "TEXT", parentId: "1:70", characters: "Loan" },
    { id: "1:70e", name: "Item", type: "TEXT", parentId: "1:70", characters: "Setting" },
  ],
  variables: [{ name: "Color/Surface/field", value: "#F8F8F8", type: "COLOR" }],
  components: [
    { id: "C:textfield", name: "TextField", key: "key-textfield" },
    { id: "1:41", name: "TextField", key: "key-textfield" },
    { id: "1:42", name: "TextField" },
    { id: "1:43", name: "TextField" },
    { id: "1:44", name: "TextField" },
    { id: "1:45", name: "TextField" },
    { id: "1:46", name: "TextField" },
    { id: "1:50", name: "Button", key: "key-button" },
    { id: "1:61", name: "HistoryCard" },
    { id: "1:70", name: "NavigationMenuV3", variantProperties: { variant: "Expenses" } },
  ],
  assets: [{ id: "A:calendar", name: "Calendar icon", type: "icon", reference: "asset://calendar" }],
});

/** A large design: 60 repeated rows, for partition-bound tests. */
export function largeSnapshot(rowCount: number): FigmaSourceSnapshot {
  const rows = Array.from({ length: rowCount }, (_, index) => [
    {
      id: `2:${index}`,
      name: `Row ${index}`,
      type: "FRAME",
      parentId: "2:list",
      childIds: [`2:${index}t`],
      absoluteBoundingBox: { x: 0, y: index * 40, width: 400, height: 40 },
    },
    { id: `2:${index}t`, name: `Row label ${index}`, type: "TEXT", parentId: `2:${index}`, characters: `Row ${index} label` },
  ]).flat();

  return figmaSourceSnapshotSchema.parse({
    source: {
      designFile: "https://www.figma.com/design/E958/Spendly?node-id=2-0",
      nodeIds: ["2:root"],
      resolvedFrames: [{ id: "2:root", name: "Long list", path: ["Long list"] }],
    },
    capabilities: { componentsAvailable: true },
    nodes: [
      { id: "2:root", name: "Long list", type: "FRAME", childIds: ["2:list"], absoluteBoundingBox: { x: 0, y: 0, width: 400, height: rowCount * 40 } },
      { id: "2:list", name: "List", type: "FRAME", parentId: "2:root", childIds: rows.filter((node) => node.type === "FRAME").map((node) => node.id), layoutMode: "VERTICAL" },
      ...rows,
    ],
  });
}
