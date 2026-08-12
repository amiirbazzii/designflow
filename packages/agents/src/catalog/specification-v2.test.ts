// packages/agents/src/catalog/specification-v2.test.ts
//
// Specification V2 contract semantics against a rich, Spendly-like Figma
// snapshot fixture: preservation of dimensions/hierarchy/styles/content,
// component contracts with per-instance differences, evidence-vs-inference
// separation, evidence-relative completeness rejection, and truthful output
// for sparse evidence. Tests target contract semantics, not full snapshots.
import { describe, expect, test } from "bun:test";
import {
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  type FigmaSourceSnapshot,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import {
  deterministicFigmaSpecificationStrategy,
  figmaSpecificationAgentManifest,
  figmaSpecificationDefaultModelProfile,
  modelFigmaSpecificationStrategy,
} from "./figma-specification-agent";
import { designEngineerCoordinatorDefaultModelProfile } from "./design-engineer-coordinator";
import { implementationDefaultModelProfile } from "./implementation-agent";
import { visualValidationDefaultModelProfile } from "./visual-validation-agent";
import { visualCorrectionDefaultModelProfile } from "./visual-correction-agent";

const EMPTY_CONTEXT: SpecializedAgentContext = {
  tools: { call: async () => { throw new Error("no tools in this test"); } },
  model: { generate: async () => { throw new Error("no model in this test"); } },
  metadata: {},
  signal: new AbortController().signal,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
};

function modelContext(output: unknown): SpecializedAgentContext {
  return { ...EMPTY_CONTEXT, model: { generate: async () => ({ type: "success", output }) as never } };
}

const FIELD_STYLE = {
  cornerRadius: 10,
  fills: [{ type: "SOLID", color: { r: 0.972, g: 0.972, b: 0.972 } }],
  strokes: [{ type: "SOLID", color: { r: 0.827, g: 0.827, b: 0.827 } }],
} as const;

function textField(id: string, name: string, characters?: string): Record<string, unknown> {
  return {
    id, name, type: "INSTANCE", parentId: "1:40", componentId: "C:textfield",
    absoluteBoundingBox: { x: 24, y: 0, width: 392, height: 56 },
    layoutMode: "HORIZONTAL", itemSpacing: 12,
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
    ...(characters !== undefined ? { characters } : {}),
    ...FIELD_STYLE,
  };
}

/** Spendly-like Add Transaction screen. */
const SPENDLY: FigmaSourceSnapshot = figmaSourceSnapshotSchema.parse({
  source: {
    designFile: "https://www.figma.com/design/E958/Spendly?node-id=1026-6098",
    nodeIds: ["1:1"],
    resolvedFrames: [{ id: "1:1", name: "Add Transaction", path: ["Add Transaction"] }],
  },
  capabilities: { componentsAvailable: true, variablesAvailable: true },
  nodes: [
    { id: "1:1", name: "Add Transaction", type: "FRAME", childIds: ["1:10", "1:20", "1:30", "1:40", "1:50", "1:60", "1:70"], absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 1092 }, layoutMode: "VERTICAL", itemSpacing: 24, padding: { top: 0, right: 24, bottom: 0, left: 24 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] },
    { id: "1:10", name: "App header", type: "FRAME", parentId: "1:1", childIds: ["1:11"], absoluteBoundingBox: { x: 0, y: 0, width: 440, height: 64 }, layoutMode: "HORIZONTAL" },
    { id: "1:11", name: "Title", type: "TEXT", parentId: "1:10", characters: "Add Transaction" },
    { id: "1:20", name: "Tabs", type: "FRAME", parentId: "1:1", childIds: ["1:21", "1:22"], layoutMode: "HORIZONTAL", itemSpacing: 8 },
    { id: "1:21", name: "Expense tab", type: "TEXT", parentId: "1:20", characters: "Expense", variantProperties: { State: "Selected" } },
    { id: "1:22", name: "Income tab", type: "TEXT", parentId: "1:20", characters: "Income", variantProperties: { State: "Default" } },
    { id: "1:30", name: "Heading", type: "TEXT", parentId: "1:1", characters: "Add New Expense" },
    { id: "1:31", name: "Subheading", type: "TEXT", parentId: "1:1", characters: "Fill in the details below to track your expense" },
    { id: "1:40", name: "Add Expense form", type: "FRAME", parentId: "1:1", childIds: ["1:41", "1:42", "1:43", "1:44", "1:45", "1:46"], layoutMode: "VERTICAL", itemSpacing: 16 },
    textField("1:41", "Amount field", "Enter amount"),
    textField("1:42", "Title field", "Add a title"),
    textField("1:43", "Card selector", "Select your card"),
    textField("1:44", "Category selector", "Select or add categories"),
    textField("1:45", "Payee field", "Who did you pay for?"),
    textField("1:46", "Date field", "1404/04/24"),
    { id: "1:47", name: "Payee optional hint", type: "TEXT", parentId: "1:45", characters: "Optional" },
    { id: "1:48", name: "Amount suffix", type: "TEXT", parentId: "1:41", characters: "Dollar" },
    { id: "1:32", name: "Form hint", type: "TEXT", parentId: "1:1", characters: "Fill the information" },
    { id: "1:62", name: "History month", type: "TEXT", parentId: "1:60", characters: "May 2024" },
    { id: "1:63", name: "History heading", type: "TEXT", parentId: "1:60", characters: "Expense History" },
    { id: "1:50", name: "Add Expense button", type: "INSTANCE", parentId: "1:1", componentId: "C:button", absoluteBoundingBox: { x: 24, y: 700, width: 392, height: 56 }, cornerRadius: 12 },
    { id: "1:60", name: "Expense History", type: "FRAME", parentId: "1:1", childIds: ["1:61"], layoutMode: "VERTICAL" },
    { id: "1:61", name: "History card", type: "INSTANCE", parentId: "1:60", componentId: "C:historycard" },
    { id: "1:70", name: "Bottom navigation", type: "INSTANCE", parentId: "1:1", componentId: "C:nav" },
  ],
  variables: [{ name: "Color/Surface/field", value: "#F8F8F8", type: "COLOR" }],
  components: [
    { id: "C:textfield", name: "TextField", key: "key-textfield", variantProperties: { Trailing: "None" } },
    { id: "C:button", name: "Button", key: "key-button" },
    { id: "C:historycard", name: "Expense History Item" },
    { id: "C:nav", name: "Navigation menu v3" },
  ],
  assets: [{ id: "A:calendar", name: "Calendar icon", type: "icon", reference: "asset://calendar" }],
});

const request = (snapshot: FigmaSourceSnapshot) => ({
  agentId: "figma-specification-agent",
  objective: "specify",
  input: { figmaSnapshot: snapshot },
  attempt: 1,
});

describe("Specification V2 — deterministic preservation", () => {
  test("root dimensions, ordered anatomy, exact copy and observed styles survive", async () => {
    const spec = await deterministicFigmaSpecificationStrategy(request(SPENDLY), EMPTY_CONTEXT, figmaSpecificationAgentManifest);

    expect(spec.screen?.name).toBe("Add Transaction");
    expect(spec.screen?.width).toBe("440px");
    expect(spec.screen?.height).toBe("1092px");
    expect(spec.screen?.layoutModel).toBe("vertical auto-layout");
    expect(spec.screen?.background).toBe("#FFFFFF");

    // ordered page anatomy with nested elements, not one flat list
    expect(spec.anatomy.map((region) => region.name)).toEqual([
      "App header", "Tabs", "Heading", "Add Expense form", "Add Expense button", "Expense History", "Bottom navigation",
    ]);
    const form = spec.anatomy.find((region) => region.name === "Add Expense form");
    const fields = form?.elements[0]?.children ?? [];
    expect(fields).toHaveLength(6);
    expect(fields[0]?.height).toBe("56px");
    expect(fields[0]?.radius).toBe("10px");
    expect(fields[0]?.background).toBe("#F8F8F8");
    expect(fields[0]?.layout?.padding).toBe("16px 16px 16px 16px");

    // exact visible copy
    for (const copy of ["Add Transaction", "Expense", "Income", "Add New Expense", "Fill in the details below to track your expense"]) {
      expect(spec.content).toContain(copy);
    }

    // foundations distinguish variables from observed values
    expect(spec.foundations?.colors.some((color) => color.name === "Color/Surface/field" && color.source === "figma-variable")).toBe(true);
    expect(spec.foundations?.colors.some((color) => color.value === "#F8F8F8" && color.source === "observed-value")).toBe(true);
    expect(spec.foundations?.radii.map((radius) => radius.value)).toContain("10px");

    // component and asset evidence
    expect(spec.components.map((component) => component.name)).toContain("Add Expense button");
    expect(spec.assetDetails[0]).toMatchObject({ id: "A:calendar", name: "Calendar icon", type: "icon", reference: "asset://calendar" });
    expect(spec.responsiveEvidence[0]).toContain("Auto-layout");
  });

  test("sparse evidence stays truthful: nothing invented, fixed-frame stated", async () => {
    const sparse = figmaSourceSnapshotSchema.parse({
      source: { designFile: "sparse.fig" },
      nodes: [{ id: "s:1", name: "Frame", type: "FRAME" }],
    });
    const spec = await deterministicFigmaSpecificationStrategy(request(sparse), EMPTY_CONTEXT, figmaSpecificationAgentManifest);
    expect(spec.content).toEqual([]);
    expect(spec.componentContracts).toEqual([]);
    expect(spec.observedStates).toEqual([]);
    expect(spec.inferredBehavior).toEqual([]);
    expect(spec.responsiveEvidence[0]).toContain("no responsive behavior is evidenced");
    expect(() => designSpecificationSchema.parse(spec)).not.toThrow();
  });
});

const RICH_MODEL_OUTPUT = {
  // Portable WIRE format: flat closed objects, nullable scalars.
  schemaVersion: "3",
  sourceIdentity: { designFile: "https://www.figma.com/design/E958/Spendly?node-id=1026-6098" },
  rootNodeId: "1:1",
  screen: { name: "Add Transaction", width: "440px", height: null, layoutModel: "vertical auto-layout", background: "#FFFFFF", scrollBehavior: null },
  regions: [
    { nodeId: "1:10", name: "App header", role: null },
    { nodeId: "1:20", name: "Tabs", role: null },
    { nodeId: "1:40", name: "Add Expense form", role: "form" },
  ],
  elements: [
    { region: "App header", parent: null, nodeId: "1:11", name: "Title", role: "text", text: "Add Transaction", width: null, height: null, layoutDirection: null, gap: null, padding: null, align: null, justify: null, sizing: null, position: null, background: null, border: null, radius: null, opacity: null, fontFamily: "Poppins", fontWeight: "600", fontSize: "20px", lineHeight: null, letterSpacing: null, textColor: "#111111", textAlign: null, effects: [], asset: null, componentName: null, states: [], notes: [] },
    { region: "Add Expense form", parent: null, nodeId: "1:41", name: "Amount field", role: "form-field", text: "Enter amount", width: "392px", height: "56px", layoutDirection: "horizontal", gap: "12px", padding: "16px 16px 16px 16px", align: null, justify: null, sizing: null, position: null, background: "#F8F8F8", border: "1px #D3D3D3", radius: "10px", opacity: null, fontFamily: null, fontWeight: null, fontSize: null, lineHeight: null, letterSpacing: null, textColor: null, textAlign: null, effects: [], asset: null, componentName: "TextField", states: [], notes: [] },
    { region: "Add Expense form", parent: "Amount field", nodeId: null, name: "Dollar suffix", role: "text", text: "Dollar", width: null, height: null, layoutDirection: null, gap: null, padding: null, align: null, justify: null, sizing: null, position: null, background: null, border: null, radius: null, opacity: null, fontFamily: null, fontWeight: null, fontSize: null, lineHeight: null, letterSpacing: null, textColor: null, textAlign: null, effects: [], asset: null, componentName: null, states: [], notes: [] },
  ],
  componentContracts: [{
    name: "TextField",
    componentKey: "key-textfield",
    componentSetName: null,
    sourceNodeIds: ["1:41", "1:42", "1:43", "1:44", "1:45", "1:46"],
    anatomy: ["leading icon slot", "value text", "trailing slot"],
    baseStyles: ["height 56px", "radius 10px", "background #F8F8F8", "border 1px #D3D3D3", "horizontal padding 16px"],
    componentProperties: [{ name: "Trailing", values: ["None"], source: "declaredByFigmaComponentMetadata" }],
    variants: [{ name: "State=Selected", source: "observedInSelection" }],
    states: [],
    instances: [
      { nodeId: "1:41", label: "amount field", differences: ["trailing \"Dollar\""] },
      { nodeId: "1:42", label: "title field", differences: ["leading icon"] },
      { nodeId: "1:43", label: "card selector", differences: ["leading icon + trailing chevron"] },
      { nodeId: "1:44", label: "category selector", differences: ["leading icon + trailing settings icon"] },
      { nodeId: "1:45", label: "payee field", differences: ["trailing \"Optional\""] },
      { nodeId: "1:46", label: "date field", differences: ["leading calendar icon + selected value"] },
    ],
    usedBy: ["Add Expense form"],
  }],
  foundations: {
    colors: [{ value: "#F8F8F8", name: "Color/Surface/field", source: "figma-variable", usage: "field background" }],
    typography: [{ value: "Poppins", name: null, source: "observed-value", usage: null }],
    spacing: [], radii: [{ value: "10px", name: null, source: "observed-value", usage: null }], borders: [], shadows: [], iconSizing: [],
  },
  assetDetails: [{ id: "A:calendar", name: "Calendar icon", type: "icon", reference: "asset://calendar", width: null, height: null, purpose: "date field leading icon" }],
  content: [
    "Add Transaction", "Expense", "Income", "Add New Expense",
    "Fill in the details below to track your expense", "Enter amount", "Dollar",
    "Add a title", "Select your card", "Select or add categories",
    "Who did you pay for?", "Optional", "1404/04/24", "Fill the information",
    "May 2024", "Expense History",
  ],
  observedStates: ["Expense tab selected, Income tab inactive"],
  inferredBehavior: ["Card selector likely opens a picker (affordance only; not confirmed)"],
  responsiveEvidence: ["Only one fixed 440px frame is available."],
  interactions: [], states: [], accessibilityNotes: [],
  layoutBehavior: [], responsiveAssumptions: [], frames: ["Add Transaction"],
  ambiguities: [{ code: "OPTION_LISTS_UNKNOWN", description: "Card and Category fields show dropdown affordances, but the snapshot does not define their option lists.", affectedNodeIds: ["1:43", "1:44"], requiresUserInput: false }],
};

const SHALLOW_BASE = {
  ...RICH_MODEL_OUTPUT,
  regions: [], elements: [], componentContracts: [], foundations: null, screen: null, rootNodeId: null,
  content: [], assetDetails: [], observedStates: [], inferredBehavior: [], responsiveEvidence: [],
  frames: [],
};

describe("Specification V2 — wire response contract", () => {
  test("a rich wire response reconstructs the full internal V2 artifact", async () => {
    const spec = await modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(RICH_MODEL_OUTPUT), figmaSpecificationAgentManifest);

    // screen + ordered regions reconstructed
    expect(spec.screen?.name).toBe("Add Transaction");
    expect(spec.screen?.width).toBe("440px");
    expect(spec.screen?.height).toBeUndefined();
    expect(spec.anatomy.map((region) => region.name)).toEqual(["App header", "Tabs", "Add Expense form"]);

    // nested element tree from flat wire elements, with structured facts
    const form = spec.anatomy.find((region) => region.name === "Add Expense form");
    const amount = form?.elements[0];
    expect(amount?.name).toBe("Amount field");
    expect(amount?.height).toBe("56px");
    expect(amount?.radius).toBe("10px");
    expect(amount?.background).toBe("#F8F8F8");
    expect(amount?.border).toBe("1px #D3D3D3");
    expect(amount?.layout?.padding).toBe("16px 16px 16px 16px");
    expect(amount?.children[0]?.text).toBe("Dollar");
    const header = spec.anatomy[0]?.elements[0];
    expect(header?.typography?.family).toBe("Poppins");
    expect(header?.typography?.size).toBe("20px");

    // component contract with all six observed instances and evidence tags
    expect(spec.componentContracts).toHaveLength(1);
    expect(spec.componentContracts[0]?.instances).toHaveLength(6);
    expect(spec.componentContracts[0]?.componentProperties[0]?.source).toBe("declaredByFigmaComponentMetadata");
    expect(spec.componentContracts[0]?.variants[0]?.source).toBe("observedInSelection");

    // foundations, assets, states, uncertainties
    expect(spec.foundations?.colors[0]).toMatchObject({ name: "Color/Surface/field", source: "figma-variable" });
    expect(spec.assetDetails[0]?.purpose).toBe("date field leading icon");
    expect(spec.observedStates[0]).toContain("Expense tab selected");
    expect(spec.inferredBehavior[0]).toContain("not confirmed");
    expect(spec.ambiguities[0]?.description).toContain("option lists");

    // derived legacy fields keep downstream consumers working
    expect(spec.hierarchy[0]).toMatchObject({ id: "1:1", name: "Add Transaction" });
    expect(spec.components[0]?.name).toBe("TextField");
    expect(spec.designTokens.referencedVariableNames).toContain("Color/Surface/field");
    expect(spec.content).toContain("Dollar");
    expect(spec.agentVersion).toBe(figmaSpecificationAgentManifest.version);
  });

  test("a shallow 'Button, Text field, Poppins' response is rejected for rich evidence", async () => {
    await expect(
      modelFigmaSpecificationStrategy(request(SPENDLY), modelContext({ ...SHALLOW_BASE }), figmaSpecificationAgentManifest),
    ).rejects.toThrow(/completeness/);
  });

  test("a fabricated element node id is rejected", async () => {
    const fabricated = {
      ...RICH_MODEL_OUTPUT,
      elements: [{ ...RICH_MODEL_OUTPUT.elements[0], nodeId: "9:999" }],
    };
    await expect(
      modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(fabricated), figmaSpecificationAgentManifest),
    ).rejects.toThrow(/not present in the source snapshot/);
  });
});

describe("Specification V2 — model profile", () => {
  test("the Specification AI ordered model policy is pinned exactly", () => {
    expect(figmaSpecificationDefaultModelProfile.id).toBe("figma-specification-default");
    expect(figmaSpecificationDefaultModelProfile.model).toBe("openai/gpt-5.6-luna");
    expect(figmaSpecificationDefaultModelProfile.fallbackModels).toEqual([
      "deepseek/deepseek-v4-pro",
      "openai/gpt-4o-mini",
    ]);
    expect(figmaSpecificationAgentManifest.modelProfileId).toBe("figma-specification-default");
  });

  test("no other agent's profile declares fallbacks in this task", () => {
    for (const profile of [
      designEngineerCoordinatorDefaultModelProfile,
      implementationDefaultModelProfile,
      visualValidationDefaultModelProfile,
      visualCorrectionDefaultModelProfile,
    ]) {
      expect(profile.fallbackModels).toEqual([]);
    }
  });

  test("no other agent's default model changed", () => {
    for (const profile of [
      designEngineerCoordinatorDefaultModelProfile,
      implementationDefaultModelProfile,
      visualValidationDefaultModelProfile,
      visualCorrectionDefaultModelProfile,
    ]) {
      expect(profile.model).toBe("openai/gpt-4o-mini");
    }
  });
});

describe("Specification V2 — quality repair stays on the same model port (no fallback for poor output)", () => {
  test("a schema-valid but evidence-incomplete response triggers bounded repair, then succeeds", async () => {
    let generateCalls = 0;
    const shallowThenRich: SpecializedAgentContext = {
      ...EMPTY_CONTEXT,
      model: {
        generate: async () => {
          generateCalls += 1;
          if (generateCalls === 1) {
            // schema-valid, but materially emptier than the evidence
            return { type: "success", output: { ...SHALLOW_BASE } } as never;
          }
          return { type: "success", output: RICH_MODEL_OUTPUT } as never;
        },
      },
    };

    const spec = await modelFigmaSpecificationStrategy(request(SPENDLY), shallowThenRich, figmaSpecificationAgentManifest);
    expect(generateCalls).toBe(2);
    expect(spec.componentContracts).toHaveLength(1);
  });

  test("if repair also produces semantically invalid output, the failure is a validation failure — not a model switch", async () => {
    const alwaysShallow: SpecializedAgentContext = {
      ...EMPTY_CONTEXT,
      model: { generate: async () => ({ type: "success", output: { ...SHALLOW_BASE } }) as never },
    };
    await expect(
      modelFigmaSpecificationStrategy(request(SPENDLY), alwaysShallow, figmaSpecificationAgentManifest),
    ).rejects.toThrow(/completeness/);
  });
});

describe("Specification V2 — content preservation (field run 689c19d9)", () => {
  const SPENDLY_COPY = [
    "Add Transaction", "Expense", "Income", "Add New Expense",
    "Fill in the details below to track your expense", "Enter amount", "Dollar",
    "Add a title", "Select your card", "Select or add categories",
    "Who did you pay for?", "Optional", "1404/04/24", "Fill the information",
    "May 2024", "Expense History",
  ];

  test("exact Spendly copy survives into the content index and elements", async () => {
    const spec = await modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(RICH_MODEL_OUTPUT), figmaSpecificationAgentManifest);
    for (const copy of SPENDLY_COPY) expect(spec.content).toContain(copy);
    // region/element association preserved
    const header = spec.anatomy.find((region) => region.name === "App header");
    expect(header?.elements[0]?.text).toBe("Add Transaction");
  });

  test("B: element text with an EMPTY explicit content index passes — content is derived, not duplicated", async () => {
    const elementCarried = {
      ...RICH_MODEL_OUTPUT,
      content: [],
      elements: [
        ...SPENDLY_COPY.map((copy, index) => ({
          ...RICH_MODEL_OUTPUT.elements[0],
          nodeId: null,
          name: `Copy ${index}`,
          text: copy,
          region: "App header",
          parent: null,
        })),
      ],
    };
    const spec = await modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(elementCarried), figmaSpecificationAgentManifest);
    for (const copy of SPENDLY_COPY) expect(spec.content).toContain(copy);
  });

  test("D: generic replacement labels fail content preservation with a specific repair message", async () => {
    const generic = {
      ...RICH_MODEL_OUTPUT,
      content: ["Page heading", "Primary input", "Navigation labels"],
      elements: [{ ...RICH_MODEL_OUTPUT.elements[0], text: "Page heading" }],
    };
    await expect(
      modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(generic), figmaSpecificationAgentManifest),
    ).rejects.toThrow(/visible text that is missing from the specification.*Preserve the exact visible copy/s);
  });

  test("E: duplicate evidence strings cause no false failure", async () => {
    const spec = await modelFigmaSpecificationStrategy(
      request(SPENDLY),
      modelContext({ ...RICH_MODEL_OUTPUT, content: [...RICH_MODEL_OUTPUT.content] }),
      figmaSpecificationAgentManifest,
    );
    expect(new Set(spec.content).size).toBe(spec.content.length);
  });

  test("F: a design with no visible text imposes no artificial content requirement", async () => {
    const sparse = figmaSourceSnapshotSchema.parse({
      source: { designFile: "sparse.fig" },
      nodes: [{ id: "s:1", name: "Frame", type: "FRAME" }],
    });
    const spec = await deterministicFigmaSpecificationStrategy(request(sparse), EMPTY_CONTEXT, figmaSpecificationAgentManifest);
    expect(spec.content).toEqual([]);
  });

  test("G: the missing-content validation issue names the exact missing strings for the repair prompt", async () => {
    const partial = {
      ...RICH_MODEL_OUTPUT,
      content: ["Add Transaction"],
      elements: [],
    };
    await expect(
      modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(partial), figmaSpecificationAgentManifest),
    ).rejects.toThrow(/including "Expense"/);
  });

  test("canonical collector reports provenance across content, elements and instances", async () => {
    const { collectSpecificationVisibleContent } = await import("@designflow/sdk");
    const spec = await modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(RICH_MODEL_OUTPUT), figmaSpecificationAgentManifest);
    const collected = collectSpecificationVisibleContent(spec);
    expect(collected.some((entry) => entry.source === "content")).toBe(true);
    expect(collected.some((entry) => entry.source === "element" && entry.region === "App header" && entry.text === "Add Transaction")).toBe(true);
    expect(collected.some((entry) => entry.source === "component-instance" && entry.text === "amount field")).toBe(true);
  });
});

describe("DF-SPEC-04 — evidence reaches the model and false unknowns are rejected", () => {
  test("the Specification Agent payload serializes instance descendant evidence verbatim", async () => {
    let captured = "";
    const capturingContext: SpecializedAgentContext = {
      ...EMPTY_CONTEXT,
      model: {
        generate: async (request: { messages: readonly { content: string }[] }) => {
          captured = request.messages.map((message) => message.content).join("\n");
          return { type: "success", output: RICH_MODEL_OUTPUT } as never;
        },
      } as never,
    };
    await modelFigmaSpecificationStrategy(request(SPENDLY), capturingContext, figmaSpecificationAgentManifest);
    for (const evidence of ["Enter amount", "Add a title", "Select your card", "Who did you pay for?", "1404/04/24"]) {
      expect(captured).toContain(evidence);
    }
    expect(captured).toContain("component/instance descendant evidence");
  });

  test("an ambiguity claiming evidenced nodes are unavailable is rejected", async () => {
    const falseUnknown = {
      ...RICH_MODEL_OUTPUT,
      ambiguities: [{
        code: "TEXTFIELD_LABELS_UNAVAILABLE",
        description: "TextField labels are not captured in the node tree.",
        affectedNodeIds: ["1:41", "1:42"],
        requiresUserInput: false,
      }],
    };
    await expect(
      modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(falseUnknown), figmaSpecificationAgentManifest),
    ).rejects.toThrow(/Do not classify a fact as unknown/);
  });

  test("a genuine uncertainty about un-evidenced nodes still passes", async () => {
    const genuine = {
      ...RICH_MODEL_OUTPUT,
      ambiguities: [{
        code: "OPTION_LISTS_UNKNOWN",
        description: "Card and Category fields show dropdown affordances, but the snapshot does not define their option lists.",
        affectedNodeIds: ["1:50"],
        requiresUserInput: false,
      }],
    };
    const spec = await modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(genuine), figmaSpecificationAgentManifest);
    expect(spec.ambiguities).toHaveLength(1);
  });
});
