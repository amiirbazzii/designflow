// packages/agents/src/ui-blueprint/test/ui-blueprint-compiler.test.ts
//
// The deterministic half of V2-1: design facts compiled from Figma evidence,
// with no model involved and none required for the result to be valid.
import { describe, expect, test } from "bun:test";

import { SPENDLY_SNAPSHOT, largeSnapshot } from "../../../test/fixtures/spendly-blueprint-snapshot";
import { compileUIBlueprintDraft, measureUIBlueprint } from "../ui-blueprint-compiler";
import { validateBlueprintCompleteness } from "../ui-blueprint-validator";

const blueprint = compileUIBlueprintDraft(SPENDLY_SNAPSHOT, { snapshotArtifactId: "snapshot-1" });
const serialized = JSON.stringify(blueprint);

function elementById(id: string) {
  return blueprint.elements.find((element) => element.id === id);
}

describe("deterministic Blueprint compiler — Spendly facts survive without any AI", () => {
  test("screen identity and dimensions", () => {
    expect(blueprint.screen.name).toBe("Add Transaction");
    expect(blueprint.screen.widthPx).toBe(440);
    expect(blueprint.screen.heightPx).toBe(1092);
    expect(blueprint.screen.background).toBe("#FFFFFF");
    expect(blueprint.provenance.snapshotArtifactId).toBe("snapshot-1");
    expect(blueprint.provenance.rootNodeIds).toContain("1:1");
  });

  test("header, tabs and their exact copy", () => {
    expect(elementById("1:11")?.facts.text).toBe("Add Transaction");
    expect(elementById("1:10")?.facts.heightPx).toBe(64);
    expect(elementById("1:11")?.facts.typography).toMatchObject({ fontFamily: "Poppins", fontStyle: "Bold", fontSizePx: 20 });
    expect(elementById("1:21")?.facts.text).toBe("Expense");
    expect(elementById("1:22")?.facts.text).toBe("Income");
    // selected vs inactive is evidenced by the tab colors, both preserved
    expect(elementById("1:21")?.facts.textColor).not.toBe(elementById("1:22")?.facts.textColor);
  });

  test("six TextField usages with exact content, slots and shared facts", () => {
    const textField = blueprint.components.find((component) => component.name === "TextField")!;
    expect(textField.instances).toHaveLength(6);
    expect(textField.sharedFacts.heightPx).toBe(56);
    expect(textField.sharedFacts.style?.radiusPx).toBe(10);
    expect(textField.sharedFacts.style?.background).toBe("#F8F8F8");
    expect(textField.sharedFacts.style?.border).toBe("#D3D3D3");
    expect(textField.sharedFacts.layout?.paddingTopPx).toBe(16);
    expect(textField.sharedFacts.layout?.gapPx).toBe(12);

    const contents = textField.instances.flatMap((instance) => instance.contents.map((slot) => slot.text));
    for (const copy of [
      "Enter amount", "Dollar", "Add a title", "Select your card",
      "Select or add categories", "Who did you pay for?", "Optional", "1404/04/24",
    ]) {
      expect(contents).toContain(copy);
    }
    const slotNames = textField.instances.flatMap((instance) => instance.contents.map((slot) => slot.name));
    for (const slot of ["Leading icon", "Card icon", "Chevron"]) {
      expect(slotNames).toContain(slot);
    }
  });

  test("primary action, history and navigation", () => {
    const button = blueprint.components.find((component) => component.name === "Button")!;
    expect(button.instances[0]?.contents.map((slot) => slot.text)).toContain("Fill the information");
    expect(button.sharedFacts.widthPx).toBe(392);
    expect(button.sharedFacts.heightPx).toBe(62);
    expect(button.sharedFacts.style?.radiusPx).toBe(12);
    expect(button.sharedFacts.style?.border).toBe("#CACACA");
    expect(button.sharedFacts.style?.effects.join(" ")).toContain("DROP_SHADOW");

    expect(blueprint.elements.map((element) => element.facts.text)).toContain("May 2024");
    expect(blueprint.elements.map((element) => element.facts.text)).toContain("Expense History");
    const card = blueprint.components.find((component) => component.name === "HistoryCard")!;
    expect(card.instances[0]?.contents.map((slot) => slot.text)).toContain("Deposit from Alex");
    expect(card.sharedFacts.style?.radiusPx).toBe(10);

    const nav = blueprint.components.find((component) => component.name === "NavigationMenuV3")!;
    expect(nav.instances[0]?.propertyValues).toEqual({ variant: "Expenses" });
    expect(nav.observedVariants).toContain("Expenses");
    for (const item of ["Add", "Report", "Invest", "Loan", "Setting"]) {
      expect(nav.instances[0]?.contents.map((slot) => slot.text)).toContain(item);
    }
  });

  test("foundations, assets and provenance", () => {
    expect(blueprint.foundations.colors.some((entry) => entry.value === "#F8F8F8")).toBe(true);
    expect(blueprint.foundations.colors.some((entry) => entry.source === "figma-variable")).toBe(true);
    expect(blueprint.foundations.radii.map((entry) => entry.value)).toContain("10px");
    expect(blueprint.foundations.typography.length).toBeGreaterThan(0);
    expect(blueprint.assets.map((asset) => asset.name)).toContain("Calendar icon");

    const knownNodeIds = new Set(SPENDLY_SNAPSHOT.nodes.map((node) => node.id));
    expect(blueprint.elements.every((element) => knownNodeIds.has(element.facts.sourceNodeId))).toBe(true);
    expect(blueprint.provenance.compilerVersion).toBe("1");
  });

  test("compilation is deterministic and requires no semantics to be valid", () => {
    const again = compileUIBlueprintDraft(SPENDLY_SNAPSHOT, { snapshotArtifactId: "snapshot-1" });
    expect(JSON.stringify(again)).toBe(serialized);
    expect(blueprint.semanticEnrichment.status).toBe("not_requested");
    expect(validateBlueprintCompleteness(blueprint, SPENDLY_SNAPSHOT)).toEqual([]);
  });

  test("completeness validation catches a Blueprint that lost evidence", () => {
    const stripped = { ...blueprint, elements: [], components: [] };
    const issues = validateBlueprintCompleteness(stripped as typeof blueprint, SPENDLY_SNAPSHOT);
    expect(issues.map((issue) => issue.code)).toContain("BLUEPRINT_NO_STRUCTURE");
    expect(issues.map((issue) => issue.code)).toContain("BLUEPRINT_CONTENT_LOST");
  });
});

describe("metrics", () => {
  test("deterministic size metrics are reported as counts and bytes only", () => {
    const metrics = measureUIBlueprint(SPENDLY_SNAPSHOT, blueprint);
    expect(metrics.blueprintElementCount).toBe(blueprint.elements.length);
    expect(metrics.blueprintComponentCount).toBe(4);
    expect(metrics.blueprintDraftBytes).toBeGreaterThan(0);
    expect(metrics.evidenceBundleBytes).toBeGreaterThan(0);
    expect(Object.values(metrics).every((value) => typeof value === "number")).toBe(true);
  });

  test("bounded collections record what they dropped", () => {
    expect(blueprint.provenance.bounds).toEqual([]);
    const large = compileUIBlueprintDraft(largeSnapshot(60));
    expect(large.provenance.bounds.every((entry) => entry.retainedCount <= entry.originalCount)).toBe(true);
  });
});
