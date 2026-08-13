// packages/agents/src/project-mapper/test/project-mapper.test.ts
//
// V2-3 acceptance: design requirements meet project facts, and every decision
// is a choice among things that exist.
import { describe, expect, test } from "bun:test";
import { MAPPING_PATCH_SCHEMA_VERSION, type SpecializedAgentContext } from "@designflow/sdk";

import { SPENDLY_SNAPSHOT } from "../../../test/fixtures/spendly-blueprint-snapshot";
import {
  EXTENSION_REQUIRED_PROJECT,
  MULTI_CANDIDATE_PROJECT,
  NO_ROUTER_PROJECT,
  REUSE_READY_PROJECT,
  SPARSE_PROJECT,
  manyCandidateProject,
} from "./fixtures/mapping-project-contexts";
import { compileUIBlueprintDraft } from "../../ui-blueprint/ui-blueprint-compiler";
import {
  compileImplementationMapDraft,
  componentRequirementId,
  SCREEN_REACHABILITY_REQUIREMENT_ID,
} from "../mapping-skeleton";
import { MAX_CANDIDATES_PER_REQUIREMENT } from "../candidate-builder";
import { partitionMappingDraft } from "../partitioner";
import { compileMappingEvidence } from "../evidence-compiler";
import { applyProjectMappingPatches, mapSkeletonFingerprint, validateMappingPatch } from "../mapping-patch-merge";
import { renderMappingReport } from "../mapping-report";
import {
  deterministicProjectMapperStrategy,
  modelProjectMapperStrategy,
  projectMapperAgentManifest,
  projectMapperDefaultModelProfile,
  MAX_MAPPING_PATCH_OUTPUT_TOKENS,
} from "../project-mapper-agent";

const blueprint = compileUIBlueprintDraft(SPENDLY_SNAPSHOT, { snapshotArtifactId: "snapshot-1" });
const draft = compileImplementationMapDraft(blueprint, REUSE_READY_PROJECT, {
  blueprintArtifactId: "ui-blueprint-1",
  projectContextArtifactId: "project-context-1",
});

const TEXTFIELD = componentRequirementId("component:TextField");
const BUTTON = componentRequirementId("component:Button");
const HISTORY = componentRequirementId("component:HistoryCard");
const NAV = componentRequirementId("component:NavigationMenuV3");

function candidateFor(requirementId: string, index = 0): string {
  return draft.candidates.find((set) => set.requirementId === requirementId)!.candidates[index]!.id;
}

function patch(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: MAPPING_PATCH_SCHEMA_VERSION,
    partitionId: "mapping:components#1",
    componentDecisions: [],
    styleDecisions: [],
    assetDecisions: [],
    compositionDecisions: [],
    uncertainties: [],
    ...overrides,
  };
}

const COMPATIBLE = { structure: "compatible", slots: "compatible", states: "compatible", visual: "compatible", interaction: "compatible" };

function decision(requirementId: string, action: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requirementId,
    action,
    compatibility: COMPATIBLE,
    requiredAdaptations: [],
    reason: `deterministic fixture decision for ${requirementId}`,
    confidence: "high",
    ...extra,
  };
}

describe("deterministic skeleton", () => {
  test("requirements are derived from the Blueprint: definitions, instances, regions, reachability", () => {
    const kinds = new Map<string, number>();
    for (const requirement of draft.requirements) kinds.set(requirement.kind, (kinds.get(requirement.kind) ?? 0) + 1);

    expect(kinds.get("component-definition")).toBe(4);
    // six TextField uses, one Button, one HistoryCard, one nav
    expect(kinds.get("component-instance")).toBe(9);
    expect(kinds.get("screen-reachability")).toBe(1);
    expect(draft.requirements.find((requirement) => requirement.id === SCREEN_REACHABILITY_REQUIREMENT_ID)).toBeDefined();

    // instance requirements carry what they demand of whatever realizes them
    const amount = draft.requirements.find((requirement) => requirement.label === "Amount field")!;
    expect(amount.parentRequirementId).toBe(TEXTFIELD);
    expect(amount.demands.join(" ")).toContain("Enter amount");
  });

  test("candidates come from the project, ordered, with the fact confidence they rest on", () => {
    const textFieldCandidates = draft.candidates.find((set) => set.requirementId === TEXTFIELD)!.candidates;
    expect(textFieldCandidates[0]?.path).toBe("src/components/ui/text-field.tsx");
    expect(textFieldCandidates[0]?.designSystemMember).toBe(true);
    expect(textFieldCandidates[0]?.matchScore).toBe(1);
    expect(textFieldCandidates[0]?.factConfidence).toBe("deterministic");
  });

  test("the draft binds to the exact design and project state it was made for", () => {
    expect(draft.binding.blueprintArtifactId).toBe("ui-blueprint-1");
    expect(draft.binding.projectContextArtifactId).toBe("project-context-1");
    expect(draft.binding.projectFingerprint).toBe("fingerprint-1");
    expect(draft.binding.blueprintScreenNodeId).toBe(blueprint.screen.rootElementId);
    expect(draft.binding.blueprintSemanticStatus).toBe("not_requested");
  });

  test("compilation is deterministic", () => {
    const again = compileImplementationMapDraft(blueprint, REUSE_READY_PROJECT, {
      blueprintArtifactId: "ui-blueprint-1",
      projectContextArtifactId: "project-context-1",
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(draft));
  });

  test("a sparse project offers no candidates rather than fake ones", () => {
    const sparse = compileImplementationMapDraft(blueprint, SPARSE_PROJECT);
    expect(sparse.candidates.every((set) => set.candidates.length === 0)).toBe(true);
    expect(sparse.destinationCandidates).toEqual([]);
    expect(sparse.requirements.length).toBe(draft.requirements.length);
  });

  test("candidate sets are bounded and the bound is recorded", () => {
    const many = compileImplementationMapDraft(blueprint, manyCandidateProject(20));
    const set = many.candidates.find((entry) => entry.requirementId === TEXTFIELD)!;
    expect(set.candidates.length).toBe(MAX_CANDIDATES_PER_REQUIREMENT);
    expect(set.bound?.truncated).toBe(true);
    expect(set.bound?.discoveredCount).toBeGreaterThan(MAX_CANDIDATES_PER_REQUIREMENT);
    expect(set.bound?.selectionRule).toContain("score");
    expect(many.bounds.some((bound) => bound.collection.startsWith("candidates:"))).toBe(true);
  });
});

// ── The Spendly-shaped acceptance ───────────────────────────────

const SPENDLY_PATCHES: unknown[] = [
  patch({
    partitionId: "mapping:destination",
    destinationDecision: {
      requirementId: SCREEN_REACHABILITY_REQUIREMENT_ID,
      action: "create_page",
      candidateId: draft.destinationCandidates.find((candidate) => candidate.kind === "candidate-directory")!.id,
      compositionRootCandidateId: draft.destinationCandidates.find((candidate) => candidate.kind === "composition-root")!.id,
      reason: "App Router project: a new page under the app directory, mounted by the existing layout",
      confidence: "high",
    },
  }),
  patch({
    partitionId: "mapping:components#1",
    componentDecisions: [
      decision(TEXTFIELD, "extend", {
        candidateId: candidateFor(TEXTFIELD),
        compatibility: { ...COMPATIBLE, slots: "partial" },
        requiredAdaptations: ["add a trailing slot for the card selector chevron"],
      }),
      decision(BUTTON, "reuse", { candidateId: candidateFor(BUTTON) }),
      decision(HISTORY, "reuse", { candidateId: candidateFor(HISTORY) }),
      decision(NAV, "reuse", { candidateId: candidateFor(NAV) }),
    ],
  }),
  patch({
    partitionId: "mapping:foundations",
    styleDecisions: [
      { designValue: "#F8F8F8", category: "color", strategy: "reuse_token", projectTokenId: "project-token-1", equivalence: "exact", reason: "the project already declares this exact surface color" },
      { designValue: "#D3D3D3", category: "color", strategy: "raw_design_value", reason: "no project token matches this border color" },
    ],
    assetDecisions: [
      { requirementId: "requirement:asset:A:calendar", strategy: "use_design_asset", reason: "no equivalent icon exists in the project" },
    ],
  }),
  patch({
    partitionId: "mapping:composition",
    compositionDecisions: blueprint.elements
      .filter((element) => element.parentId === blueprint.screen.rootElementId)
      .map((element, index) => ({ blueprintRef: element.id, order: index, childRefs: [] })),
  }),
];

describe("Spendly-shaped mapping", () => {
  const map = applyProjectMappingPatches(draft, SPENDLY_PATCHES, { partitionCount: SPENDLY_PATCHES.length });

  test("every design component receives an explicit decision, resolved to a real project file", () => {
    expect(map.components).toHaveLength(4);
    const textField = map.components.find((component) => component.requirementId === TEXTFIELD)!;
    expect(textField.action).toBe("extend");
    expect(textField.projectTarget?.path).toBe("src/components/ui/text-field.tsx");
    expect(textField.requiredAdaptations[0]).toContain("trailing slot");
    expect(map.components.filter((component) => component.action === "reuse")).toHaveLength(3);
  });

  test("the screen becomes reachable through an explicit destination and composition root", () => {
    expect(map.screen?.destination.action).toBe("create_page");
    expect(map.screen?.destination.path).toBe("src/app");
    expect(map.screen?.compositionRootPath).toBe("src/app/layout.tsx");
    expect(map.composition?.nodes.length).toBeGreaterThan(0);
  });

  test("component decisions are separate from instance coverage", () => {
    const instances = map.coverage.entries.filter((entry) => entry.kind === "component-instance");
    expect(instances).toHaveLength(9);
    expect(instances.every((entry) => entry.status === "mapped")).toBe(true);

    // a blanket reuse whose slots are incompatible cannot carry its instances
    const blanket = applyProjectMappingPatches(
      draft,
      [
        patch({
          componentDecisions: [
            decision(TEXTFIELD, "reuse", {
              candidateId: candidateFor(TEXTFIELD),
              compatibility: { ...COMPATIBLE, slots: "incompatible" },
            }),
          ],
        }),
      ],
      { partitionCount: 4 },
    );
    const textFieldInstances = blanket.coverage.entries.filter(
      (entry) => entry.kind === "component-instance" && entry.requirementId.includes("component:TextField"),
    );
    expect(textFieldInstances).toHaveLength(6);
    expect(textFieldInstances.every((entry) => entry.status === "unresolved")).toBe(true);
    expect(textFieldInstances[0]?.note).toContain("extend or create");
  });

  test("no Blueprint requirement disappears, and coverage is complete", () => {
    expect(map.coverage.retained).toBe(draft.requirements.length);
    expect(map.coverage.truncated).toBe(false);
    expect(map.coverage.status).toBe("complete");
    expect(map.status).toBe("complete");
    for (const label of ["Add Transaction", "Amount field", "Primary action", "History card", "Bottom navigation"]) {
      expect(map.coverage.entries.some((entry) => entry.label === label)).toBe(true);
    }
  });

  test("styling maps exact values, and refuses to substitute a token that is not equivalent", () => {
    const surface = map.styles.find((style) => style.designValue === "#F8F8F8")!;
    expect(surface.strategy).toBe("reuse_token");
    expect(surface.projectTokenReference).toBe("var(--surface-muted)");
    expect(surface.equivalence).toBe("exact");
    const border = map.styles.find((style) => style.designValue === "#D3D3D3")!;
    expect(border.strategy).toBe("raw_design_value");
    expect(border.projectTokenReference).toBeUndefined();
  });

  test("host-owned facts survive the merge unchanged", () => {
    expect(mapSkeletonFingerprint(map)).toBe(mapSkeletonFingerprint(draft));
    expect(JSON.stringify(map.requirements)).toBe(JSON.stringify(draft.requirements));
    expect(JSON.stringify(map.candidates)).toBe(JSON.stringify(draft.candidates));
  });

  test("the report reads as a plan, from the map alone", () => {
    const report = renderMappingReport(map)
      .map((section) => `## ${section.title}\n${section.lines.join("\n")}`)
      .join("\n\n");
    expect(report).toContain("Create page: src/app");
    expect(report).toContain("Mounted through: src/app/layout.tsx");
    expect(report).toContain("→ Extend existing TextField");
    expect(report).toContain("Instances: 6/6 satisfied");
    expect(report).toContain("complete");
  });
});

describe("mapping shapes per project", () => {
  test("B: a component that cannot express an instance is extended, not reused", () => {
    const extensionDraft = compileImplementationMapDraft(blueprint, EXTENSION_REQUIRED_PROJECT);
    const textFieldCandidates = extensionDraft.candidates.find((set) => set.requirementId === TEXTFIELD)!.candidates;
    expect(textFieldCandidates[0]?.name).toBe("TextField");

    const map = applyProjectMappingPatches(
      extensionDraft,
      [
        patch({
          componentDecisions: [
            decision(TEXTFIELD, "extend", {
              candidateId: textFieldCandidates[0]!.id,
              compatibility: { ...COMPATIBLE, slots: "partial" },
              requiredAdaptations: ["add leading/trailing slots", "add a select variant"],
            }),
          ],
        }),
      ],
      { partitionCount: 1 },
    );
    expect(map.components[0]?.action).toBe("extend");
    expect(map.coverage.entries.filter((entry) => entry.kind === "component-instance" && entry.status === "mapped")).toHaveLength(6);
  });

  test("C: a component with no candidate is created into an offered directory", () => {
    const sparseDraft = compileImplementationMapDraft(blueprint, SPARSE_PROJECT);
    expect(sparseDraft.candidates.find((set) => set.requirementId === HISTORY)?.candidates).toEqual([]);

    const map = applyProjectMappingPatches(
      sparseDraft,
      [
        patch({
          componentDecisions: [
            decision(HISTORY, "create", {
              plannedDirectoryId: sparseDraft.plannedDirectories[0]!.id,
              plannedName: "HistoryCard.tsx",
            }),
          ],
        }),
      ],
      { partitionCount: 1 },
    );
    expect(map.components[0]?.action).toBe("create");
    // the path is derived by the host from an offered directory, never given
    expect(map.components[0]?.plannedPath).toBe("src/HistoryCard.tsx");
  });

  test("D: several candidates are offered and one is selected", () => {
    const multiDraft = compileImplementationMapDraft(blueprint, MULTI_CANDIDATE_PROJECT);
    const candidates = multiDraft.candidates.find((set) => set.requirementId === TEXTFIELD)!.candidates;
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates[0]?.name).toBe("TextField");

    const chosen = candidates[1]!;
    const map = applyProjectMappingPatches(
      multiDraft,
      [patch({ componentDecisions: [decision(TEXTFIELD, "extend", { candidateId: chosen.id })] })],
      { partitionCount: 1 },
    );
    expect(map.components[0]?.projectTarget?.path).toBe(chosen.path);
  });

  test("E: a project with no router still gets a destination decision from real candidates", () => {
    const noRouter = compileImplementationMapDraft(blueprint, NO_ROUTER_PROJECT);
    expect(noRouter.destinationCandidates).toHaveLength(1);
    const map = applyProjectMappingPatches(
      noRouter,
      [
        patch({
          partitionId: "mapping:destination",
          destinationDecision: {
            requirementId: SCREEN_REACHABILITY_REQUIREMENT_ID,
            action: "integrate_existing_root",
            candidateId: noRouter.destinationCandidates[0]!.id,
            reason: "no router is declared; the screen mounts in the existing app root",
            confidence: "medium",
          },
        }),
      ],
      { partitionCount: 1 },
    );
    expect(map.screen?.destination.path).toBe("src/App.tsx");
    expect(map.coverage.entries.find((entry) => entry.kind === "screen-reachability")?.status).toBe("mapped");
  });
});

// ── Protections ─────────────────────────────────────────────────

describe("bad and hostile patches", () => {
  test("A: an unknown Blueprint requirement is rejected", () => {
    expect(() => validateMappingPatch(patch({ componentDecisions: [decision("requirement:component:ghost", "create")] }), draft))
      .toThrow(/UNKNOWN_BLUEPRINT_REFERENCE|does not contain/);
  });

  test("B: a project component the host never offered is rejected", () => {
    expect(() =>
      validateMappingPatch(patch({ componentDecisions: [decision(TEXTFIELD, "reuse", { candidateId: "candidate-that-does-not-exist" })] }), draft),
    ).toThrow(/UNKNOWN_PROJECT_COMPONENT|does not contain/);
  });

  test("B2: a candidate offered for a different requirement is rejected", () => {
    expect(() =>
      validateMappingPatch(patch({ componentDecisions: [decision(TEXTFIELD, "reuse", { candidateId: candidateFor(BUTTON) })] }), draft),
    ).toThrow(/not offered for/);
  });

  test("C: reuse without a target is rejected", () => {
    expect(() => validateMappingPatch(patch({ componentDecisions: [decision(TEXTFIELD, "reuse")] }), draft))
      .toThrow(/without naming which existing component/);
  });

  test("D: create claiming an existing target is rejected", () => {
    expect(() =>
      validateMappingPatch(patch({ componentDecisions: [decision(HISTORY, "create", { candidateId: candidateFor(HISTORY) })] }), draft),
    ).toThrow(/create while also selecting an existing/);
  });

  test("E: an unknown destination is rejected", () => {
    expect(() =>
      validateMappingPatch(
        patch({
          destinationDecision: {
            requirementId: SCREEN_REACHABILITY_REQUIREMENT_ID,
            action: "use_existing",
            candidateId: "destination-999",
            reason: "invented",
            confidence: "high",
          },
        }),
        draft,
      ),
    ).toThrow(/UNKNOWN_DESTINATION|does not offer/);
  });

  test("F: an unknown token is rejected", () => {
    expect(() =>
      validateMappingPatch(
        patch({ styleDecisions: [{ designValue: "#F8F8F8", category: "color", strategy: "reuse_token", projectTokenId: "project-token-999", reason: "invented" }] }),
        draft,
      ),
    ).toThrow(/UNKNOWN_TOKEN|does not exist/);
  });

  test("G: two partitions disagreeing about one requirement is a conflict", () => {
    expect(() =>
      applyProjectMappingPatches(
        draft,
        [
          patch({ partitionId: "p1", componentDecisions: [decision(BUTTON, "reuse", { candidateId: candidateFor(BUTTON) })] }),
          patch({ partitionId: "p2", componentDecisions: [decision(BUTTON, "create", { plannedDirectoryId: draft.plannedDirectories[0]!.id })] }),
        ],
        { partitionCount: 2 },
      ),
    ).toThrow(/PATCH_CONFLICT|already applied/);
  });

  test("H: a patch that tries to author host facts is refused before parsing", () => {
    const hostile = { ...(patch() as Record<string, unknown>), binding: { projectFingerprint: "attacker-fingerprint" } };
    expect(() => validateMappingPatch(hostile, draft)).toThrow(/FACT_OVERRIDE|host-owned facts/);
    expect(draft.binding.projectFingerprint).toBe("fingerprint-1");
  });

  test("H2: a patch smuggling a path or code into a prose field is refused", () => {
    expect(() =>
      validateMappingPatch(
        patch({ componentDecisions: [decision(HISTORY, "create", { plannedDirectoryId: draft.plannedDirectories[0]!.id, reason: "export function HistoryCard() { return <div/>; }" })] }),
        draft,
      ),
    ).toThrow(/may not carry code/);
    expect(() => validateMappingPatch({ ...(patch() as Record<string, unknown>), files: ["src/x.tsx"] }, draft)).toThrow(/host-owned facts/);
  });

  test("I: a patch cannot remove a required mapping — requirements are host-owned", () => {
    const withoutRequirements = applyProjectMappingPatches(draft, [patch()], { partitionCount: 4 });
    expect(withoutRequirements.requirements).toHaveLength(draft.requirements.length);
    // and an undecided requirement is reported, never dropped
    expect(withoutRequirements.coverage.status).toBe("incomplete");
    expect(withoutRequirements.coverage.entries.filter((entry) => entry.status === "unresolved").length).toBeGreaterThan(0);
  });

  test("J: composition referencing an unmapped requirement is rejected", () => {
    expect(() =>
      applyProjectMappingPatches(
        draft,
        [patch({ compositionDecisions: [{ blueprintRef: "1:10", order: 0, componentRequirementId: TEXTFIELD, childRefs: [] }] })],
        { partitionCount: 1 },
      ),
    ).toThrow(/no mapping decided/);
  });
});

// ── Staging, failure and coverage ───────────────────────────────

describe("staged mapping", () => {
  const partitions = partitionMappingDraft(draft);

  test("mapping is partitioned by stage, in dependency order, each bounded", () => {
    expect(partitions.map((partition) => partition.stage)).toEqual(["destination", "components", "foundations", "composition"]);
    for (const partition of partitions) {
      expect(partition.serializedBytes).toBeLessThan(24_000);
    }
    // partition order and ids are stable across compilations
    const again = partitionMappingDraft(
      compileImplementationMapDraft(blueprint, REUSE_READY_PROJECT, {
        blueprintArtifactId: "ui-blueprint-1",
        projectContextArtifactId: "project-context-1",
      }),
    );
    expect(again.map((partition) => partition.id)).toEqual(partitions.map((partition) => partition.id));
  });

  test("a request carries only its own requirements and candidates", () => {
    const componentPartition = partitions.find((partition) => partition.stage === "components")!;
    const evidence = compileMappingEvidence(componentPartition, draft, blueprint, REUSE_READY_PROJECT);
    const serialized = JSON.stringify(evidence);

    expect(serialized).toContain("Enter amount");
    // no destination inventory, no token table, no unrelated project facts
    expect(serialized).not.toContain("src/app/layout.tsx");
    expect(serialized).not.toContain("var(--surface-muted)");
    expect(serialized).not.toContain("vitest");
    expect(evidence.bytes).toBeLessThan(24_000);
  });

  test("heuristic project facts stay marked heuristic in the evidence", () => {
    const componentPartition = partitions.find((partition) => partition.stage === "components")!;
    const evidence = compileMappingEvidence(componentPartition, draft, blueprint, REUSE_READY_PROJECT);
    expect(JSON.stringify(evidence.project)).toContain("heuristic");
  });

  test("a failed partition keeps the successful ones and reports partial", () => {
    const map = applyProjectMappingPatches(draft, [SPENDLY_PATCHES[0]!, SPENDLY_PATCHES[1]!], {
      partitionCount: 4,
      failures: [{ partitionId: "mapping:foundations", code: "ERR_MODEL_TIMEOUT" }],
    });
    expect(map.status).toBe("partial");
    expect(map.components).toHaveLength(4);
    expect(map.screen).toBeDefined();
    expect(map.mapper.failures[0]?.partitionId).toBe("mapping:foundations");
    expect(mapSkeletonFingerprint(map)).toBe(mapSkeletonFingerprint(draft));
  });

  test("no patches at all leaves the draft inspectable and says mapping was unavailable", () => {
    const map = applyProjectMappingPatches(draft, [], {
      partitionCount: 4,
      failures: [{ partitionId: "mapping:destination", code: "ERR_MODEL_CANDIDATES_EXHAUSTED" }],
    });
    expect(map.status).toBe("unavailable");
    expect(map.components).toEqual([]);
    expect(map.requirements).toHaveLength(draft.requirements.length);
    expect(map.candidates.length).toBeGreaterThan(0);
    // nothing is invented to fill the gap
    expect(map.coverage.entries.every((entry) => entry.status === "unresolved")).toBe(true);
  });

  test("merging is deterministic", () => {
    const first = applyProjectMappingPatches(draft, SPENDLY_PATCHES, { partitionCount: 4 });
    const second = applyProjectMappingPatches(draft, SPENDLY_PATCHES, { partitionCount: 4 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("coverage truncation is never silent", () => {
  test("a truncated requirement set cannot report complete", () => {
    const truncatedDraft = {
      ...draft,
      requirements: draft.requirements.slice(0, 5),
      bounds: [
        {
          collection: "requirements",
          discoveredCount: draft.requirements.length,
          retainedCount: 5,
          limit: 5,
          truncated: true,
          selectionRule: "Blueprint order",
        },
      ],
    };
    const map = applyProjectMappingPatches(truncatedDraft, [patch()], { partitionCount: 1 });
    expect(map.coverage.truncated).toBe(true);
    expect(map.coverage.status).toBe("truncated");
    expect(map.coverage.totalRequired).toBe(draft.requirements.length);
    expect(map.coverage.retained).toBe(5);
    expect(map.status).not.toBe("complete");
    expect(renderMappingReport(map).find((section) => section.title === "Coverage")?.lines.join(" ")).toContain("Truncated");
  });
});

// ── The agent ───────────────────────────────────────────────────

describe("Project Mapper agent", () => {
  const partitions = partitionMappingDraft(draft);
  const componentPartition = partitions.find((partition) => partition.stage === "components")!;
  const evidence = compileMappingEvidence(componentPartition, draft, blueprint, REUSE_READY_PROJECT);

  const context = (generate: (request: { messages: readonly { content: string }[] }) => unknown): SpecializedAgentContext =>
    ({
      tools: { call: async () => { throw new Error("no tools"); } },
      metadata: {},
      signal: new AbortController().signal,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      model: { generate: async (request: never) => generate(request) },
    }) as never;

  test("its own profile, standard candidate order, no raised timeout", () => {
    expect(projectMapperDefaultModelProfile.id).toBe("project-mapper-default");
    expect(projectMapperDefaultModelProfile.id).not.toBe("design-interpreter-default");
    expect(projectMapperDefaultModelProfile.model).toBe("openai/gpt-4o-mini");
    expect(projectMapperDefaultModelProfile.timeoutMs).toBeUndefined();
    expect(MAX_MAPPING_PATCH_OUTPUT_TOKENS).toBe(2500);
    expect(projectMapperAgentManifest.allowedTools).toEqual([]);
  });

  test("the request states the decision and its allowed ids, and carries no secrets", async () => {
    let captured = "";
    await modelProjectMapperStrategy(
      { agentId: "project-mapper-agent", objective: "map", input: { evidence }, attempt: 1 },
      context((request) => {
        captured = request.messages.map((message) => message.content).join("\n");
        return {
          type: "success",
          output: { componentDecisions: [], destinationDecision: null, styleDecisions: [], assetDecisions: [], compositionDecisions: [], uncertainties: [] },
        };
      }),
      projectMapperAgentManifest,
    );
    expect(captured).toContain("Decide exactly these");
    expect(captured).toContain(TEXTFIELD);
    expect(captured).not.toContain("OPENROUTER");
    expect(captured.length).toBeLessThan(24_000);
  });

  test("a decision outside the partition's allowed ids is rejected", async () => {
    await expect(
      modelProjectMapperStrategy(
        { agentId: "project-mapper-agent", objective: "map", input: { evidence }, attempt: 1 },
        context(() => ({
          type: "success",
          output: {
            componentDecisions: [
              {
                requirementId: SCREEN_REACHABILITY_REQUIREMENT_ID,
                action: "create",
                candidateId: null,
                plannedDirectoryId: null,
                plannedName: null,
                compatibility: COMPATIBLE,
                requiredAdaptations: [],
                reason: "out of scope",
                confidence: "low",
              },
            ],
            destinationDecision: null,
            styleDecisions: [],
            assetDecisions: [],
            compositionDecisions: [],
            uncertainties: [],
          },
        })),
        projectMapperAgentManifest,
      ),
    ).rejects.toThrow(/outside this partition/);
  });

  test("the offline strategy decides nothing rather than guessing", async () => {
    const produced = await deterministicProjectMapperStrategy(
      { agentId: "project-mapper-agent", objective: "map", input: { evidence }, attempt: 1 },
      context(() => { throw new Error("unused"); }),
      projectMapperAgentManifest,
    );
    expect(produced.componentDecisions).toEqual([]);
    expect(produced.uncertainties[0]?.code).toBe("MAPPING_NOT_PERFORMED");
  });
});
