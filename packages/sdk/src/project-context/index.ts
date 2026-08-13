// packages/sdk/src/project-context/index.ts
//
// Two distinct things, deliberately kept apart:
//
//   canonical-project-context.ts  the per-run compiled truth about a project
//                                 (`CanonicalProjectContext`) — canonical
//   durable-project-facts.ts      the cross-run fact table (`ProjectContext`,
//                                 `ProjectFact`) — selected memory, never
//                                 authority over fresh inspection
export {
  CANONICAL_PROJECT_CONTEXT_SCHEMA_VERSION,
  PROJECT_CONTEXT_ARTIFACT_ID,
  PROJECT_CONTEXT_ARTIFACT_TYPE,
  projectEvidenceSourceSchema,
  projectEvidenceConfidenceSchema,
  projectProvenanceSchema,
  evidencedValueSchema,
  projectBoundSchema,
  projectRuntimeSchema,
  projectAliasSchema,
  projectStructureSchema,
  projectRoutingKindSchema,
  projectRoutingSchema,
  projectDestinationSchema,
  projectStylingSchema,
  projectTokenSchema,
  projectDesignSystemSchema,
  projectComponentSchema,
  projectCommandSchema,
  projectTestingSchema,
  projectCapabilitiesSchema,
  projectConventionSchema,
  canonicalProjectContextSchema,
} from "./canonical-project-context";

export type {
  ProjectEvidenceSource,
  ProjectEvidenceConfidence,
  ProjectProvenance,
  ProjectBound,
  ProjectAlias,
  ProjectDestination,
  ProjectComponent,
  CanonicalProjectContext,
} from "./canonical-project-context";

export {
  projectFactSchema,
  projectFactInputSchema,
  projectFactChangeSchema,
  projectContextSchema,
  projectContextSourceMetadataSchema,
  projectFactSourceSchema,
  applyProjectFactChanges,
} from "./durable-project-facts";

export type {
  ProjectFactSource,
  ProjectFact,
  ProjectFactInput,
  ProjectFactChange,
  ProjectContext,
  ProjectContextStore,
} from "./durable-project-facts";
