// packages/sdk/src/implementation-map/index.ts
//
//   implementation-map-schema.ts  the plan itself, and the host-owned draft
//                                 (requirements + candidates + binding)
//   mapping-patch-schema.ts       the bounded decisions a mapper may author
//
// The split is the same one the Blueprint uses: the deterministic side owns
// every reference, the model side owns judgment, and the patch schema is
// physically unable to express a project fact or a line of code.
export {
  IMPLEMENTATION_MAP_SCHEMA_VERSION,
  IMPLEMENTATION_MAP_ARTIFACT_ID,
  IMPLEMENTATION_MAP_ARTIFACT_TYPE,
  implementationMapBindingSchema,
  mappingBoundSchema,
  mappingCandidateSchema,
  destinationCandidateSchema,
  mappingRequirementKindSchema,
  mappingRequirementSchema,
  mappingActionSchema,
  mappingCompatibilitySchema,
  componentMappingSchema,
  screenMappingSchema,
  styleMappingSchema,
  assetMappingSchema,
  compositionNodeSchema,
  compositionMappingSchema,
  coverageStatusSchema,
  coverageEntrySchema,
  mappingCoverageSchema,
  mappingUncertaintySchema,
  mappingStatusSchema,
  implementationMapDraftSchema,
  implementationMapSchema,
} from "./implementation-map-schema";

export type {
  ImplementationMapBinding,
  MappingBound,
  MappingCandidate,
  DestinationCandidate,
  MappingRequirement,
  MappingAction,
  MappingCompatibility,
  ComponentMapping,
  ScreenMapping,
  StyleMapping,
  AssetMapping,
  MappingCoverage,
  CoverageEntry,
  CoverageStatus,
  CompositionNode,
  CompositionMapping,
  MappingUncertainty,
  MappingStatus,
  ImplementationMapDraft,
  ImplementationMap,
} from "./implementation-map-schema";

export {
  MAPPING_PATCH_SCHEMA_VERSION,
  MAPPING_PATCH_FORBIDDEN_FIELDS,
  MAPPING_PATCH_CODE_MARKERS,
  componentDecisionSchema,
  destinationDecisionSchema,
  styleDecisionSchema,
  assetDecisionSchema,
  compositionDecisionSchema,
  mappingPatchSchema,
} from "./mapping-patch-schema";

export type {
  MappingPatch,
  ComponentDecision,
  DestinationDecision,
  StyleDecision,
  AssetDecision,
} from "./mapping-patch-schema";
