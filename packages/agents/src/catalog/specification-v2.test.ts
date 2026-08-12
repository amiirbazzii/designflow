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

function textField(id: string, name: string): Record<string, unknown> {
  return {
    id, name, type: "INSTANCE", parentId: "1:40", componentId: "C:textfield",
    absoluteBoundingBox: { x: 24, y: 0, width: 392, height: 56 },
    layoutMode: "HORIZONTAL", itemSpacing: 12,
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
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
    textField("1:41", "Amount field"),
    textField("1:42", "Title field"),
    textField("1:43", "Card selector"),
    textField("1:44", "Category selector"),
    textField("1:45", "Payee field"),
    textField("1:46", "Date field"),
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
    schemaVersion: "3",
    sourceIdentity: { designFile: "https://www.figma.com/design/E958/Spendly?node-id=1026-6098" },
    screenshotArtifactIds: [],
    frames: ["Add Transaction"],
    hierarchy: [{ id: "1:1", name: "Add Transaction" }],
    designTokens: { colors: ["#F8F8F8"], spacing: ["16px"], typography: ["Poppins"], radii: ["10px"], borders: ["1px #D3D3D3"], shadows: [], referencedVariableNames: ["Color/Surface/field"] },
    components: [{ name: "TextField", role: "form-field", sourceNodeIds: ["1:41"], variants: [], requiredAssets: [], implementationNotes: [] }],
    layoutBehavior: [], responsiveAssumptions: [],
    assets: [{ id: "A:calendar", name: "Calendar icon" }],
    content: ["Add Transaction", "Enter amount", "Dollar"],
    interactions: [], states: [], accessibilityNotes: [],
    ambiguities: [{ code: "OPTION_LISTS_UNKNOWN", description: "Card and Category fields show dropdown affordances, but the snapshot does not define their option lists.", affectedNodeIds: ["1:43", "1:44"], requiresUserInput: false }],
    agentVersion: "ignored",
    screen: { name: "Add Transaction", width: "440px", height: null, layoutModel: "vertical auto-layout", background: "#FFFFFF", scrollBehavior: null },
    anatomy: [
      { nodeId: "1:10", name: "App header", role: null, elements: [{ nodeId: "1:11", name: "Title", role: "text", text: "Add Transaction", width: null, height: null, layout: null, background: null, border: null, radius: null, opacity: null, typography: { family: "Poppins", weight: "600", size: "20px", lineHeight: null, letterSpacing: null, color: "#111111", align: null }, effects: [], asset: null, componentName: null, states: [], notes: [], children: [] }] },
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
    foundations: { colors: [{ value: "#F8F8F8", name: "Color/Surface/field", source: "figma-variable", usage: "field background" }], typography: [{ value: "Poppins", name: null, source: "observed-value", usage: null }], spacing: [], radii: [], borders: [], shadows: [], iconSizing: [] },
    assetDetails: [{ id: "A:calendar", name: "Calendar icon", type: "icon", reference: "asset://calendar", width: null, height: null, purpose: "date field leading icon" }],
    observedStates: ["Expense tab selected, Income tab inactive"],
    inferredBehavior: ["Card selector likely opens a picker (affordance only; not confirmed)"],
    responsiveEvidence: ["Only one fixed 440px frame is available."],
};

const SHALLOW_BASE = {
  ...RICH_MODEL_OUTPUT,
  anatomy: [], componentContracts: [], foundations: null, screen: null,
  hierarchy: [], components: [], content: [],
  designTokens: { colors: [], spacing: [], typography: [], radii: [], borders: [], shadows: [], referencedVariableNames: [] },
  assetDetails: [], observedStates: [], inferredBehavior: [], responsiveEvidence: [],
};

describe("Specification V2 — model output contract", () => {
  test("a rich V2 model response validates: nulls stripped, evidence sources kept, instances preserved", async () => {
    const spec = await modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(RICH_MODEL_OUTPUT), figmaSpecificationAgentManifest);
    expect(spec.componentContracts).toHaveLength(1);
    expect(spec.componentContracts[0]?.instances).toHaveLength(6);
    expect(spec.componentContracts[0]?.componentProperties[0]?.source).toBe("declaredByFigmaComponentMetadata");
    expect(spec.componentContracts[0]?.variants[0]?.source).toBe("observedInSelection");
    expect(spec.screen?.height).toBeUndefined();
    expect(spec.observedStates[0]).toContain("Expense tab selected");
    expect(spec.inferredBehavior[0]).toContain("not confirmed");
    expect(spec.ambiguities[0]?.description).toContain("option lists");
    expect(spec.agentVersion).toBe(figmaSpecificationAgentManifest.version);
  });

  test("a shallow 'Button, Text field, Poppins' response is rejected for rich evidence", async () => {
    const shallow = { ...SHALLOW_BASE };
    await expect(
      modelFigmaSpecificationStrategy(request(SPENDLY), modelContext(shallow), figmaSpecificationAgentManifest),
    ).rejects.toThrow(/completeness/);
  });

  test("a fabricated anatomy node id is rejected", async () => {
    const fabricated = {
      ...RICH_MODEL_OUTPUT,
      anatomy: [{ nodeId: "9:999", name: "Ghost region", role: null, elements: [] }],
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
