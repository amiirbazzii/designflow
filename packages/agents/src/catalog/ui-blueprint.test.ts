// packages/agents/src/catalog/ui-blueprint.test.ts
//
// V2-1 acceptance: the canonical UI Blueprint.
//
// The load-bearing claim of the whole architecture is tested here — design
// facts are compiled deterministically from Figma evidence and cannot be
// changed by a model, while semantics are additive and allowed to fail.
import { describe, expect, test } from "bun:test";
import { UI_SEMANTIC_PATCH_SCHEMA_VERSION, type SpecializedAgentContext, type UISemanticPatch } from "@designflow/sdk";

import { SPENDLY_SNAPSHOT, largeSnapshot } from "../../test/fixtures/spendly-blueprint-snapshot";
import { compileUIBlueprintDraft, measureUIBlueprint } from "./ui-blueprint-compiler";
import { applySemanticPatches, blueprintFactsFingerprint, validateSemanticPatch } from "./ui-blueprint-merge";
import { partitionBlueprintForEnrichment, MAX_PARTITION_ELEMENTS } from "./ui-blueprint-partition";
import { validateBlueprintCompleteness, collectBlueprintVisibleText } from "./ui-blueprint-validation";
import { blueprintToDesignSpecification, renderBlueprintSpecification } from "./ui-blueprint-specification";
import {
  designInterpreterAgentManifest,
  designInterpreterDefaultModelProfile,
  deterministicDesignInterpreterStrategy,
  modelDesignInterpreterStrategy,
  MAX_SEMANTIC_PATCH_OUTPUT_TOKENS,
} from "./design-interpreter-agent";

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

// ── Semantic patches ────────────────────────────────────────────

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

describe("semantic enrichment is additive and cannot touch design facts", () => {
  test("a full merge attaches semantics and regions while facts stay identical", () => {
    const before = blueprintFactsFingerprint(blueprint);
    const merged = applySemanticPatches(blueprint, SPENDLY_PATCHES, { partitionCount: SPENDLY_PATCHES.length });

    expect(blueprintFactsFingerprint(merged)).toBe(before);
    expect(merged.semanticEnrichment.status).toBe("completed");
    expect(merged.semanticEnrichment.patchCount).toBe(4);

    expect(merged.elements.find((element) => element.id === "1:41")?.semantics).toMatchObject({
      role: "form_control",
      purpose: "amount_input",
      interactionKind: "text_entry",
    });
    expect(merged.elements.find((element) => element.id === "1:43")?.semantics.purpose).toBe("payment_method_selector");
    expect(merged.components.find((component) => component.name === "NavigationMenuV3")?.semantics.purpose).toBe("bottom_navigation");
    expect(merged.semanticRegions.map((region) => region.name)).toEqual(["Header", "Tabs", "Add Expense Form"]);
    expect(merged.relationships[0]).toMatchObject({ kind: "submits", fromId: "1:50", toId: "1:40" });

    // every fact is still exactly what the compiler produced
    expect(merged.elements.find((element) => element.id === "1:41")?.facts).toEqual(
      blueprint.elements.find((element) => element.id === "1:41")!.facts,
    );
  });

  test("region membership follows compiled source order, not the order a model listed", () => {
    const shuffled = patch({
      partitionId: "region:1:40",
      regionAnnotations: [
        { name: "Add Expense Form", memberElementIds: ["1:46", "1:41", "1:43"], role: "form", evidenceBasis: "explicit_design_evidence", notes: [] },
      ],
    });
    const merged = applySemanticPatches(blueprint, [shuffled], { partitionCount: 1 });
    expect(merged.semanticRegions[0]?.memberElementIds).toEqual(["1:41", "1:43", "1:46"]);
  });

  test("merging is deterministic for the same inputs", () => {
    const first = applySemanticPatches(blueprint, SPENDLY_PATCHES, { partitionCount: 4 });
    const second = applySemanticPatches(blueprint, SPENDLY_PATCHES, { partitionCount: 4 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("bad and hostile patches", () => {
  test("A: an unknown element id is rejected", () => {
    expect(() =>
      validateSemanticPatch(
        patch({ elementAnnotations: [{ elementId: "9:999", role: "action", notes: [] }] }),
        blueprint,
      ),
    ).toThrow(/ERR_BLUEPRINT_PATCH_UNKNOWN_REFERENCE|does not contain/);
  });

  test("B: an unknown component id is rejected", () => {
    expect(() =>
      validateSemanticPatch(
        patch({ componentAnnotations: [{ componentId: "component:Imaginary", role: "card", notes: [] }] }),
        blueprint,
      ),
    ).toThrow(/does not contain/);
  });

  test("C: a patch carrying a design fact is refused before it can be parsed", () => {
    const factOverride = {
      ...(patch() as Record<string, unknown>),
      elementAnnotations: [{ elementId: "1:41", role: "form_control", heightPx: 72, background: "#FFFFFF", notes: [] }],
    };
    expect(() => validateSemanticPatch(factOverride, blueprint)).toThrow(/ERR_BLUEPRINT_PATCH_FACT_OVERRIDE|may not carry design facts/);
    // …and the fact is untouched no matter what
    expect(elementById("1:41")?.facts.heightPx).toBe(56);
    expect(elementById("1:41")?.facts.style?.background).toBe("#F8F8F8");
  });

  test("C2: the patch schema itself has nowhere to put a fact", () => {
    const merged = applySemanticPatches(blueprint, [patch({
      elementAnnotations: [{ elementId: "1:41", role: "form_control", notes: [] }],
    })], { partitionCount: 1 });
    expect(JSON.stringify(merged.elements.find((element) => element.id === "1:41")?.facts)).toBe(
      JSON.stringify(elementById("1:41")?.facts),
    );
  });

  test("D: two patches with conflicting authoritative semantics are rejected", () => {
    expect(() =>
      applySemanticPatches(
        blueprint,
        [
          patch({ partitionId: "p1", elementAnnotations: [{ elementId: "1:41", role: "form_control", notes: [] }] }),
          patch({ partitionId: "p2", elementAnnotations: [{ elementId: "1:41", role: "card", notes: [] }] }),
        ],
        { partitionCount: 2 },
      ),
    ).toThrow(/ERR_BLUEPRINT_PATCH_CONFLICT|already applied/);
  });

  test("D2: an identical repeated annotation is idempotent, not a conflict", () => {
    const annotation = { elementId: "1:41", role: "form_control" as const, purpose: "amount_input", notes: [] };
    const merged = applySemanticPatches(
      blueprint,
      [patch({ partitionId: "p1", elementAnnotations: [annotation] }), patch({ partitionId: "p2", elementAnnotations: [annotation] })],
      { partitionCount: 2 },
    );
    expect(merged.elements.find((element) => element.id === "1:41")?.semantics.purpose).toBe("amount_input");
  });

  test("E: a relationship endpoint that is not a Blueprint entity is rejected", () => {
    expect(() =>
      validateSemanticPatch(
        patch({ relationships: [{ kind: "labels", fromId: "1:41", toId: "ghost:1", evidenceBasis: "semantic_inference" }] }),
        blueprint,
      ),
    ).toThrow(/does not contain/);
  });

  test("F: with no patches at all the Blueprint stays valid and says enrichment was unavailable", () => {
    const merged = applySemanticPatches(blueprint, [], {
      partitionCount: 4,
      failures: [
        { partitionId: "region:1:10", code: "ERR_MODEL_CANDIDATES_EXHAUSTED" },
        { partitionId: "region:1:40", code: "ERR_MODEL_CANDIDATES_EXHAUSTED" },
      ],
    });
    expect(merged.semanticEnrichment.status).toBe("unavailable");
    expect(merged.semanticEnrichment.failures).toHaveLength(2);
    expect(blueprintFactsFingerprint(merged)).toBe(blueprintFactsFingerprint(blueprint));
    expect(validateBlueprintCompleteness(merged, SPENDLY_SNAPSHOT)).toEqual([]);
    expect(collectBlueprintVisibleText(merged)).toContain("Enter amount");
  });

  test("G: some partitions succeeding leaves a valid, partially enriched Blueprint", () => {
    const merged = applySemanticPatches(blueprint, [SPENDLY_PATCHES[0]!, SPENDLY_PATCHES[2]!], {
      partitionCount: 4,
      failures: [{ partitionId: "region:1:20", code: "ERR_MODEL_TIMEOUT" }],
    });
    expect(merged.semanticEnrichment.status).toBe("partial");
    expect(merged.semanticEnrichment.patchCount).toBe(2);
    expect(merged.semanticRegions.map((region) => region.name)).toEqual(["Header", "Add Expense Form"]);
    expect(validateBlueprintCompleteness(merged, SPENDLY_SNAPSHOT)).toEqual([]);
  });
});

// ── Bounded, staged enrichment ──────────────────────────────────

describe("staged enrichment partitions", () => {
  test("a screen is partitioned per region and per component, never as one request", () => {
    const partitions = partitionBlueprintForEnrichment(blueprint);
    expect(partitions.length).toBeGreaterThan(1);
    expect(partitions.some((partition) => partition.kind === "region")).toBe(true);
    expect(partitions.some((partition) => partition.kind === "component")).toBe(true);

    const allElementIds = new Set(blueprint.elements.map((element) => element.id));
    for (const partition of partitions) {
      expect(partition.allowedElementIds.length).toBeLessThan(allElementIds.size);
      expect(partition.allowedElementIds.every((id) => allElementIds.has(id))).toBe(true);
      expect(partition.serializedBytes).toBeLessThan(24_000);
      expect(JSON.stringify(partition.context)).not.toContain("Bank Deposit" + " ");
    }

    // every element the screen owns is covered by exactly one region partition
    const covered = new Set(partitions.filter((partition) => partition.kind === "region").flatMap((partition) => partition.allowedElementIds));
    for (const element of blueprint.elements) {
      if (element.id === blueprint.screen.rootElementId) continue;
      expect(covered.has(element.id)).toBe(true);
    }
  });

  test("a large region is split into bounded chunks, and one failed chunk does not corrupt the rest", () => {
    const large = compileUIBlueprintDraft(largeSnapshot(60));
    const partitions = partitionBlueprintForEnrichment(large);
    expect(partitions.every((partition) => partition.allowedElementIds.length <= MAX_PARTITION_ELEMENTS)).toBe(true);
    expect(partitions.filter((partition) => partition.id.startsWith("region:2:list")).length).toBeGreaterThan(1);

    const first = partitions[0]!;
    const merged = applySemanticPatches(
      large,
      [
        patch({
          partitionId: first.id,
          elementAnnotations: [{ elementId: first.allowedElementIds[0]!, role: "list", notes: [] }],
        }),
      ],
      { partitionCount: partitions.length, failures: [{ partitionId: partitions[1]!.id, code: "ERR_MODEL_TIMEOUT" }] },
    );
    expect(merged.semanticEnrichment.status).toBe("partial");
    expect(blueprintFactsFingerprint(merged)).toBe(blueprintFactsFingerprint(large));
  });

  test("partition ids and order are stable across compilations", () => {
    const again = compileUIBlueprintDraft(SPENDLY_SNAPSHOT, { snapshotArtifactId: "snapshot-1" });
    expect(partitionBlueprintForEnrichment(again).map((partition) => partition.id)).toEqual(
      partitionBlueprintForEnrichment(blueprint).map((partition) => partition.id),
    );
  });
});

// ── Design Interpreter ──────────────────────────────────────────

describe("Design Interpreter", () => {
  const partitions = partitionBlueprintForEnrichment(blueprint);
  const formPartition = partitions.find((partition) => partition.id === "region:1:40")!;

  const context = (generate: (request: { messages: readonly { content: string }[] }) => unknown): SpecializedAgentContext =>
    ({
      tools: { call: async () => { throw new Error("no tools"); } },
      metadata: {},
      signal: new AbortController().signal,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      model: { generate: async (request: never) => generate(request) },
    }) as never;

  test("the profile reuses the standard ordered-candidate policy with no raised timeout", () => {
    expect(designInterpreterDefaultModelProfile.id).toBe("design-interpreter-default");
    expect(designInterpreterDefaultModelProfile.model).toBe("openai/gpt-4o-mini");
    expect(designInterpreterDefaultModelProfile.timeoutMs).toBeUndefined();
    expect(MAX_SEMANTIC_PATCH_OUTPUT_TOKENS).toBe(2000);
    expect(designInterpreterAgentManifest.allowedTools).toEqual([]);
  });

  test("the request carries only its own partition and an explicit allowed-id list", async () => {
    let captured = "";
    await modelDesignInterpreterStrategy(
      { agentId: "design-interpreter-agent", objective: "annotate", input: { partition: formPartition }, attempt: 1 },
      context((request) => {
        captured = request.messages.map((message) => message.content).join("\n");
        return { type: "success", output: { elementAnnotations: [], componentAnnotations: [], regionAnnotations: [], relationships: [], uncertainties: [] } };
      }),
      designInterpreterAgentManifest,
    );

    expect(captured).toContain("Allowed element ids: 1:40");
    expect(captured).toContain("Enter amount");
    // no unrelated region, and no whole-Blueprint dump
    expect(captured).not.toContain("Deposit from Alex");
    expect(captured.length).toBeLessThan(24_000);
  });

  test("annotations outside the partition's allowed set are rejected", async () => {
    await expect(
      modelDesignInterpreterStrategy(
        { agentId: "design-interpreter-agent", objective: "annotate", input: { partition: formPartition }, attempt: 1 },
        context(() => ({
          type: "success",
          output: {
            elementAnnotations: [{ elementId: "1:70", role: "navigation", purpose: null, interactionKind: null, importance: null, confidence: null, evidenceBasis: null }],
            componentAnnotations: [], regionAnnotations: [], relationships: [], uncertainties: [],
          },
        })),
        designInterpreterAgentManifest,
      ),
    ).rejects.toThrow(/outside this partition/);
  });

  test("the offline strategy invents nothing", async () => {
    const produced = await deterministicDesignInterpreterStrategy(
      { agentId: "design-interpreter-agent", objective: "annotate", input: { partition: formPartition }, attempt: 1 },
      context(() => { throw new Error("unused"); }),
      designInterpreterAgentManifest,
    );
    expect(produced.elementAnnotations).toEqual([]);
    expect(produced.regionAnnotations).toEqual([]);
    expect(produced.uncertainties[0]?.code).toBe("SEMANTIC_INTERPRETATION_NOT_PERFORMED");
  });
});

// ── The Specification becomes a view ────────────────────────────

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
