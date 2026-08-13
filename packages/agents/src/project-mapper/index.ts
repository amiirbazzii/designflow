// packages/agents/src/project-mapper/index.ts
//
// Design-to-project decisions. See ./README.md for the boundary.
export {
  compileImplementationMapDraft,
  componentRequirementId,
  instanceRequirementId,
  regionRequirementId,
  assetRequirementId,
  SCREEN_REACHABILITY_REQUIREMENT_ID,
  IMPLEMENTATION_MAP_COMPILER_VERSION,
  MAX_REQUIREMENTS,
  type CompileDraftOptions,
} from "./mapping-skeleton";

export {
  buildComponentCandidates,
  plannedDirectoriesFor,
  projectTokensFor,
  projectAssetsFor,
  MAX_CANDIDATES_PER_REQUIREMENT,
  type CandidateSet,
} from "./candidate-builder";

export {
  partitionMappingDraft,
  MAX_COMPONENTS_PER_PARTITION,
  MAX_MAPPING_PARTITION_BYTES,
  type MappingPartition,
  type MappingStage,
} from "./partitioner";

export { compileMappingEvidence, type MappingEvidenceBundle } from "./evidence-compiler";

export {
  applyProjectMappingPatches,
  mapSkeletonFingerprint,
  validateMappingPatch,
  type ApplyMappingPatchesOptions,
  type MappingPatchFailure,
} from "./mapping-patch-merge";

export {
  createProjectMapperAgent,
  projectMapperAgent,
  projectMapperAgentManifest,
  projectMapperDefaultModelProfile,
  deterministicProjectMapperStrategy,
  modelProjectMapperStrategy,
  PROJECT_MAPPER_AGENT_ID,
  PROJECT_MAPPER_AGENT_VERSION,
  MAX_MAPPING_PATCH_OUTPUT_TOKENS,
  type ProjectMapperStrategy,
} from "./project-mapper-agent";

export { mappingPatchResponseSchema } from "./mapping-patch-response-schema";
export { renderMappingReport, type MappingReportSection } from "./mapping-report";
