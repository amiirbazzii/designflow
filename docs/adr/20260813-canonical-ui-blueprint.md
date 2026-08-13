# ADR: Canonical UI Blueprint

Status: accepted for Agent Architecture V2, phase V2-1. The flagship workflow
is unchanged; nothing here is wired into `design-to-code-implementation` yet.

## Decision

The canonical **UI Blueprint** (`packages/sdk/src/ui-blueprint/`,
`uiBlueprintSchema`, schemaVersion 1) becomes DesignFlow's source of design
truth. The human-readable Specification stops being a document a model writes
and other agents re-read, and becomes a deterministic view of the Blueprint.

The eight commitments this rests on:

1. **The Blueprint is the design source of truth.** Downstream V2 stages —
   Project Mapper, UI Builder, Visual Critic — read it, not prose.
2. **Deterministic facts are compiler-owned.** `compileUIBlueprintDraft`
   (`packages/agents/src/ui-blueprint/ui-blueprint-compiler.ts`) builds every fact
   from the normalized `SpecificationEvidenceBundle`: dimensions, layout,
   spacing, colors, borders, radii, effects, typography, exact copy, component
   identity, instance property values, slots, assets. No model participates.
3. **AI semantics are additive.** A model contributes only a
   `UISemanticPatch` — roles, purposes, interaction kinds, region names,
   relationships, uncertainties. Semantics live in their own object on every
   entity, and a Blueprint with none is already valid and usable.
4. **AI cannot override facts.** The patch schema is `.strict()` and has no
   field capable of expressing a dimension, color, radius, typeface, variant
   or line of copy, so an override cannot be represented. `applySemanticPatches`
   additionally scans raw input for fact-shaped keys
   (`ERR_BLUEPRINT_PATCH_FACT_OVERRIDE`) and fingerprints every compiler-owned
   fact before and after the merge, refusing the result if the two differ.
5. **The Specification is a Blueprint view.** `renderBlueprintSpecification`
   produces the sectioned document; `blueprintToDesignSpecification` produces
   the legacy `DesignSpecification` V2 artifact so today's consumers keep
   working during migration. Both are deterministic projections.
6. **Project mapping is downstream.** The Blueprint is project-independent: no
   file paths, no framework or styling choice, no reuse/extend/create
   decision, no route. Those belong to the Project Mapper (V2-3).
7. **Semantic enrichment is bounded and staged.** `partitionBlueprintForEnrichment` (`design-interpreter/semantic-partitioner.ts`)
   splits a Blueprint into one request per top-level region and one per
   component family, each carrying only its own compiled facts and an explicit
   allowed-id list, bounded to 40 elements / 24 KB per request. There is no
   whole-screen semantic call, and the interpreter profile keeps the default
   timeout — if a partition ever needed a raised one, the partition is wrong.
8. **The Blueprint survives interpreter failure.** When enrichment is
   unavailable or partial the artifact says so
   (`semanticEnrichment.status = unavailable | partial`, with per-partition
   failure codes) and every design fact is unaffected. Degraded-mode policy for
   later stages is deferred to V2-3, when the Project Mapper exists.

## Why not evolve `DesignSpecification` in place

Three live consumers read its legacy flat fields: `mapDesignSystem`,
`deriveImplementationCoveragePlan`, and `store-implementation-plan`. Changing
that schema under them would put the deterministic safety layer at risk for no
V2-1 benefit. A separate canonical artifact plus a deterministic projection
gives the new contract room to be right without a migration in the same step.

## Why the patch, and not a whole Blueprint from the model

The legacy Specification agent authored an entire design document in one call.
Every observed field failure followed from that: truncation against the output
ceiling, a 91.5-second generation, a repair attempt that exhausted the
candidate budget. Measured on the Spendly fixture, the V2 shape is a largest
request of 1,463 bytes and a worst-case patch of ~689 output tokens against a
configured 2,000-token budget — two orders of magnitude away from the failure
mode, and per-partition recoverable when one call does fail.

## Consequences

- Compiler changes must bump `UI_BLUEPRINT_COMPILER_VERSION`; the Blueprint
  records it, so stale artifacts are identifiable.
- Bounded collections record `originalCount`/`retainedCount`/`reason` in
  `provenance.bounds`. Silent truncation is a defect, not a default.
- Blueprint entity ids are source node ids (and `component:<name>` for
  component definitions), so future coverage can reference regions,
  components, instances and required elements without inventing identifiers.
- The legacy `figma-specification-agent` remains the flagship path and is
  untouched by this phase; it is expected to be deprecated once V2 migration
  reaches the flagship dispatch.
