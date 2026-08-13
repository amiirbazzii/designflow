// packages/agents/src/design-interpreter/index.ts
//
// Semantic interpretation of an already-compiled Blueprint.
// See ./README.md for the boundary this module must not cross.
export {
  createDesignInterpreterAgent,
  designInterpreterAgent,
  designInterpreterAgentManifest,
  designInterpreterDefaultModelProfile,
  deterministicDesignInterpreterStrategy,
  modelDesignInterpreterStrategy,
  DESIGN_INTERPRETER_AGENT_ID,
  DESIGN_INTERPRETER_AGENT_VERSION,
  MAX_SEMANTIC_PATCH_OUTPUT_TOKENS,
  type DesignInterpreterStrategy,
} from "./design-interpreter-agent";

export {
  partitionBlueprintForEnrichment,
  MAX_PARTITION_ELEMENTS,
  MAX_PARTITION_BYTES,
  type BlueprintPartition,
} from "./semantic-partitioner";

export {
  applySemanticPatches,
  blueprintFactsFingerprint,
  validateSemanticPatch,
  type ApplySemanticPatchesOptions,
  type SemanticPatchFailure,
} from "./semantic-patch-merge";

export { uiSemanticPatchResponseSchema } from "./semantic-patch-response-schema";
