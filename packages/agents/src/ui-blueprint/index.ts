// packages/agents/src/ui-blueprint/index.ts
//
// The canonical UI Blueprint: deterministic design facts.
// See ./README.md for what this module does and does not own.
export {
  compileUIBlueprintDraft,
  compileUIBlueprintDraftFromBundle,
  measureUIBlueprint,
  UI_BLUEPRINT_COMPILER_VERSION,
  type CompileUIBlueprintOptions,
  type UIBlueprintMetrics,
} from "./ui-blueprint-compiler";

export {
  validateBlueprintCompleteness,
  collectBlueprintVisibleText,
  blueprintPreservesSpecificationContent,
  type BlueprintValidationIssue,
} from "./ui-blueprint-validator";
