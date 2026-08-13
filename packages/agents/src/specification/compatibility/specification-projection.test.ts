// packages/agents/src/specification/compatibility/specification-projection.test.ts
//
// The Specification is a view: both projections state Blueprint facts and
// nothing else, with or without semantic enrichment.
import { describe, expect, test } from "bun:test";
import { UI_SEMANTIC_PATCH_SCHEMA_VERSION, type UISemanticPatch } from "@designflow/sdk";

import { SPENDLY_SNAPSHOT } from "../../../test/fixtures/spendly-blueprint-snapshot";
import { compileUIBlueprintDraft } from "../../ui-blueprint/ui-blueprint-compiler";
import { applySemanticPatches } from "../../design-interpreter/semantic-patch-merge";
import { blueprintToDesignSpecification, renderBlueprintSpecification } from "./specification-projection";

const blueprint = compileUIBlueprintDraft(SPENDLY_SNAPSHOT, { snapshotArtifactId: "snapshot-1" });

function patch(overrides: Partial<UISemanticPatch> = {}): unknown {
  return {
    schemaVersion: UI_SEMANTIC_PATCH_SCHEMA_VERSION,
    partitionId: "region:1:40",
    elementAnnotations: [],
    componentAnnotations: [],
    regionAnnotations: [],
    relationships: [],
    uncertainties: [],
    ...overrides,
  };
}

const SPENDLY_PATCHES: unknown[] = [
  patch({
    partitionId: "region:1:10",
    elementAnnotations: [
      { elementId: "1:11", role: "heading", purpose: "screen_title", evidenceBasis: "explicit_design_evidence", notes: [] },
      { elementId: "1:12", role: "action", interactionKind: "navigation", purpose: "back", evidenceBasis: "visual_inference", notes: [] },
    ],
    regionAnnotations: [
      { name: "Header", memberElementIds: ["1:10", "1:11", "1:12"], anchorElementId: "1:10", role: "header", evidenceBasis: "explicit_design_evidence", notes: [] },
    ],
  }),
  patch({
    partitionId: "region:1:20",
    regionAnnotations: [
      { name: "Tabs", memberElementIds: ["1:20", "1:21", "1:22"], role: "tabs", evidenceBasis: "explicit_design_evidence", notes: [] },
    ],
    elementAnnotations: [
      { elementId: "1:21", role: "tabs", interactionKind: "tab_switch", purpose: "expense_tab", evidenceBasis: "explicit_design_evidence", notes: [] },
    ],
  }),
  patch({
    partitionId: "region:1:40",
    elementAnnotations: [
      { elementId: "1:41", role: "form_control", purpose: "amount_input", interactionKind: "text_entry", evidenceBasis: "explicit_design_evidence", notes: [] },
      { elementId: "1:43", role: "form_control", purpose: "payment_method_selector", interactionKind: "selection", evidenceBasis: "semantic_inference", notes: [] },
    ],
    regionAnnotations: [
      { name: "Add Expense Form", memberElementIds: ["1:40", "1:41", "1:42", "1:43", "1:44", "1:45", "1:46"], anchorElementId: "1:40", role: "form", evidenceBasis: "explicit_design_evidence", notes: [] },
    ],
    relationships: [{ kind: "submits", fromId: "1:50", toId: "1:40", evidenceBasis: "semantic_inference" }],
  }),
  patch({
    partitionId: "component:component:NavigationMenuV3",
    componentAnnotations: [
      { componentId: "component:NavigationMenuV3", role: "navigation", purpose: "bottom_navigation", evidenceBasis: "component_metadata", notes: [] },
    ],
    elementAnnotations: [
      { elementId: "1:70", role: "navigation", purpose: "bottom_navigation", interactionKind: "navigation", evidenceBasis: "component_metadata", notes: [] },
    ],
  }),
];

describe("Specification projection", () => {
  test("the human-readable document reports Blueprint facts, enriched", () => {
    const merged = applySemanticPatches(blueprint, SPENDLY_PATCHES, { partitionCount: 4 });
    const document = renderBlueprintSpecification(merged)
      .map((section) => `## ${section.title}\n${section.lines.join("\n")}`)
      .join("\n\n");

    expect(document).toContain("440×1092");
    expect(document).toContain("Add Transaction");
    expect(document).toContain("Header");
    expect(document).toContain("Add Expense Form");
    for (const copy of ["Enter amount", "Select your card", "Fill the information", "May 2024", "Setting"]) {
      expect(document).toContain(copy);
    }
    expect(document).toContain("#F8F8F8");
  });

  test("without any AI the same factual content is still in the document", () => {
    const document = renderBlueprintSpecification(blueprint)
      .map((section) => `## ${section.title}\n${section.lines.join("\n")}`)
      .join("\n\n");

    for (const copy of [
      "Add Transaction", "Expense", "Income", "Enter amount", "Dollar", "Add a title",
      "Select your card", "Select or add categories", "Who did you pay for?", "Optional",
      "1404/04/24", "Fill the information", "May 2024", "Expense History", "Setting",
    ]) {
      expect(document).toContain(copy);
    }
    expect(document).toContain("440×1092");
    expect(document).toContain("radius 10px");
  });

  test("the legacy DesignSpecification projection keeps existing consumers working", () => {
    const merged = applySemanticPatches(blueprint, SPENDLY_PATCHES, { partitionCount: 4 });
    const specification = blueprintToDesignSpecification(merged, { agentVersion: "0.1.0", screenshotArtifactIds: ["shot-1"] });

    expect(specification.schemaVersion).toBe("3");
    expect(specification.screen?.width).toBe("440px");
    expect(specification.hierarchy.length).toBe(merged.elements.length);
    expect(specification.anatomy.map((region) => region.name)).toContain("Add Expense Form");
    expect(specification.componentContracts.find((contract) => contract.name === "TextField")?.instances).toHaveLength(6);
    for (const copy of ["Enter amount", "Fill the information", "Setting"]) {
      expect(specification.content).toContain(copy);
    }
    // inference stays labelled as inference, never as Figma evidence
    expect(specification.inferredBehavior.join(" ")).toContain("inferred");
  });
});
