// packages/sdk/src/product-stages/design-to-code-stages.ts
//
// The ONE canonical Design-to-Code product-stage definition (V2-9).
//
// Before this file, the same stage story lived in at least four independent
// lists across the TUI and the CLI presentation services, each keyed to the
// legacy Coordinator-era capabilities. Every presentation surface now derives
// from here; a second semantic list is a bug, and a guard test looks for one.
//
// Vocabulary is product language, never architecture language: a person sees
// "Planning", not "map-v2-project", and never a workflow id. Model names and
// profile ids deliberately do not appear in this contract.

export const DESIGN_TO_CODE_STAGE_IDS = [
  "understanding",
  "planning",
  "building",
  "checking",
  "refining",
  "review",
  "applying",
  "done",
] as const;

export type DesignToCodeStageId = (typeof DESIGN_TO_CODE_STAGE_IDS)[number];

export interface DesignToCodeProductStage {
  readonly id: DesignToCodeStageId;
  readonly label: string;
  readonly order: number;
  readonly description: string;
  /**
   * Whether the stage appears in a normal run's stage list before it has any
   * activity. `refining` is conditional: it exists only when a repair
   * iteration actually ran — an accepted first implementation must not show a
   * completed "Refining" that never happened. `done` is the terminal outcome,
   * rendered as the result rather than a list row.
   */
  readonly normalVisible: boolean;
}

export const DESIGN_TO_CODE_PRODUCT_STAGES: readonly DesignToCodeProductStage[] = [
  { id: "understanding", label: "Understanding", order: 1, description: "Reading the design and the project", normalVisible: true },
  { id: "planning", label: "Planning", order: 2, description: "Matching the design to this project and its destination", normalVisible: true },
  { id: "building", label: "Building", order: 3, description: "Preparing and validating the implementation", normalVisible: true },
  { id: "checking", label: "Checking", order: 4, description: "Rendering the implementation and comparing it with the design", normalVisible: true },
  { id: "refining", label: "Refining", order: 5, description: "Improving the implementation from measured differences", normalVisible: false },
  { id: "review", label: "Review", order: 6, description: "The exact proposal, waiting for your approval", normalVisible: true },
  { id: "applying", label: "Applying", order: 7, description: "Snapshot, apply and required validation", normalVisible: true },
  { id: "done", label: "Done", order: 8, description: "The final outcome of this run", normalVisible: false },
];

export function designToCodeStage(id: DesignToCodeStageId): DesignToCodeProductStage {
  return DESIGN_TO_CODE_PRODUCT_STAGES.find((stage) => stage.id === id)!;
}

/**
 * Every V2 flagship workflow node, mapped to exactly one product stage.
 *
 * Keys are the flagship's capability ids — the stable engine-facing contract
 * the progress event stream already carries. Nothing here is hidden: all 16
 * nodes have user-relevant meaning. `run-visual-convergence` presents as
 * `checking` while live (repair activity inside it is only knowable from the
 * convergence artifact afterwards, which is when `refining` appears).
 */
export const DESIGN_TO_CODE_V2_STAGE_BY_CAPABILITY: Readonly<Record<string, DesignToCodeStageId>> = {
  "parse-figma-source": "understanding",
  "retrieve-figma-source-snapshot": "understanding",
  "compile-v2-blueprint": "understanding",
  "compile-v2-project-context": "understanding",
  "map-v2-project": "planning",
  "build-v2-implementation": "building",
  "run-visual-convergence": "checking",
  "assert-v2-finalizable": "checking",
  "inspect-finalization-project": "review",
  "resolve-selected-proposal": "review",
  "store-final-review": "review",
  "request-implementation-approval": "review",
  "create-project-snapshot": "applying",
  "apply-approved-file-changes": "applying",
  "run-project-validation": "applying",
  "store-finalization-result": "done",
};

/**
 * Historical runs: the legacy Coordinator-era capabilities, translated into
 * the same canonical vocabulary so old sessions and artifacts still render.
 * Compatibility only — the normal flagship never emits these ids.
 */
export const DESIGN_TO_CODE_LEGACY_STAGE_BY_CAPABILITY: Readonly<Record<string, DesignToCodeStageId>> = {
  "prepare-figma-source-fixture": "understanding",
  "invoke-figma-specification-agent": "understanding",
  "store-stage-3-summary": "understanding",
  "inspect-registered-project": "understanding",
  "map-design-system": "planning",
  "store-implementation-plan": "planning",
  "invoke-implementation-agent": "building",
  "store-proposed-file-changes": "building",
  "store-generated-implementation": "building",
  "prepare-visual-validation": "checking",
  "start-preview-server": "checking",
  "capture-implementation-screenshots": "checking",
  "resolve-reference-evidence": "checking",
  "store-dom-and-computed-style-evidence": "checking",
  "compare-visual-evidence": "checking",
  "invoke-visual-validation-agent": "checking",
  "invoke-visual-validation-agent-stage5": "checking",
  "store-visual-validation-report": "checking",
  "store-stage-5-summary": "checking",
  "select-actionable-findings": "refining",
  "prepare-correction-context": "refining",
  "store-correction-plan": "refining",
  "store-proposed-correction-changes": "refining",
  "request-correction-approval": "refining",
  "consume-correction-approval": "refining",
  "create-correction-snapshot": "refining",
  "apply-approved-correction": "refining",
  "run-correction-project-validation": "refining",
  "rerun-stage5-visual-validation": "refining",
  "evaluate-feedback-loop": "refining",
  "store-feedback-loop-input": "refining",
  "store-feedback-loop-iteration": "refining",
  "normalize-feedback-loop-revalidation-gate": "refining",
  "store-stage-6-summary": "refining",
  "run-project-validation": "applying",
  "create-project-snapshot": "applying",
  "apply-approved-file-changes": "applying",
  "store-implementation-validation": "applying",
  "store-stage-4-summary": "done",
};

/** The canonical stage for any capability id, current or historical. */
export function designToCodeStageForCapability(capabilityId: string): DesignToCodeStageId | undefined {
  return (
    DESIGN_TO_CODE_V2_STAGE_BY_CAPABILITY[capabilityId] ??
    DESIGN_TO_CODE_LEGACY_STAGE_BY_CAPABILITY[capabilityId]
  );
}

// ── AI role presentation ────────────────────────────────────────

/**
 * The four current Design Engineer AI roles, as a person sees them.
 *
 * `visual_repair` is deliberately NOT a fifth role: the repairing agent is
 * the UI Builder, and `uiBuilderRepairActivity` is the sanctioned wording for
 * that mode. Legacy specialist labels live beside them for historical traces
 * only.
 */
export const DESIGN_TO_CODE_AI_ROLES = [
  { id: "design-interpreter", label: "Design Interpreter", profileId: "design-interpreter-default" },
  { id: "project-mapper", label: "Project Mapper", profileId: "project-mapper-default" },
  { id: "ui-builder", label: "UI Builder", profileId: "ui-builder-default" },
  { id: "visual-critic", label: "Visual Critic", profileId: "visual-critic-default" },
] as const;

export type DesignToCodeAiRoleId = (typeof DESIGN_TO_CODE_AI_ROLES)[number]["id"];

export const UI_BUILDER_REPAIR_ACTIVITY_LABEL = "UI Builder — refining implementation";

/** Historical trace/actor ids → compatibility display labels. */
export const LEGACY_AI_ROLE_LABELS: Readonly<Record<string, string>> = {
  "design-engineer-coordinator": "Design Engineer Coordinator (legacy)",
  "figma-specification-agent": "Figma Specification Specialist (legacy)",
  "implementation-agent": "Implementation Specialist (legacy)",
  "visual-validation-agent": "Visual Validation Specialist (legacy)",
  "visual-correction-agent": "Visual Correction Specialist (legacy)",
};
