// packages/agents/src/specification/index.ts
//
// Specification: the compact evidence bundle, the Blueprint projections, and
// the legacy Specification path retained during V2 migration.
// See ./README.md.
export {
  compileSpecificationEvidenceBundle,
  estimateTokens,
  type SpecificationEvidenceBundle,
  type EvidenceElement,
  type EvidenceComponent,
  type EvidenceInstance,
  type EvidenceFoundations,
  type EvidenceBundleMetrics,
} from "./evidence/specification-evidence-bundle";

export {
  renderBlueprintSpecification,
  blueprintToDesignSpecification,
  blueprintContent,
  type SpecificationSection,
} from "./compatibility/specification-projection";

// Legacy: the pre-V2 model-authored Specification path. Still the flagship
// workflow's agent until the V2 migration reaches dispatch; not the design
// source of truth in V2.
export {
  createFigmaSpecificationAgent,
  figmaSpecificationAgent,
  figmaSpecificationAgentManifest,
  figmaSpecificationDefaultModelProfile,
  deterministicFigmaSpecificationStrategy,
  modelFigmaSpecificationStrategy,
  type FigmaSpecificationStrategy,
} from "./legacy/figma-specification-agent";

export { figmaSpecificationWireSchema, wireToDesignSpecification } from "./legacy/specification-wire";
