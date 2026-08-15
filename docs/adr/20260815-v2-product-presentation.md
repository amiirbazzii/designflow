# ADR: V2 product presentation — one canonical Design-to-Code stage source

Date: 2026-08-15
Status: accepted
Phase: V2-9

## Context

After the V2 flagship migration (see `20260815-v2-flagship-migration.md`),
the terminal product still presented the run through several independently
maintained stage vocabularies (TUI stage order/labels, workflow stage list,
output definitions, progress definitions, AI actor tables). They disagreed
with each other and with the live 16-node `design-to-code-v2` workflow.

## Decision

- The SDK owns the single semantic source of truth:
  `packages/sdk/src/product-stages/design-to-code-stages.ts` defines the
  product stages — Understanding, Planning, Building, Checking, Refining
  (conditional), Review, Applying, Done (internal) — the capability→stage
  maps for all 16 flagship nodes plus the legacy compatibility map, and the
  four V2 AI roles (Design Interpreter, Project Mapper, UI Builder, Visual
  Critic) with their model-profile ids.
- Every CLI/TUI consumer derives from that module. No presentation file may
  hold its own literal stage list (guarded by a duplication test).
- Refining is only rendered when a refinement iteration was actually
  observed; Done is never a workflow row. A pending approval always
  reconstructs the Review stage, including on a resumed execution.
- The review screen renders the exact convergence-selected proposal
  (`proposed-file-changes`) enriched with checks from `v2-final-review`;
  finalization statuses map to product outcome copy; the refinement story
  derives from `visual-convergence`, never from legacy correction artifacts.
- Settings, actors and details present the V2 roles; legacy specialist
  names remain readable in history only.
- The canonical Figma screenshot flows into pixel comparison: when the
  convergence input carries no reference screenshots, the renderer seam
  resolves them from the persisted `figma-source-snapshot` (identity-checked
  by file key and node id). Pixel policy and thresholds are unchanged.

## Consequences

- User copy never says "V2", and normal mode exposes no workflow ids or
  hashes; those remain in Details.
- The PTY acceptance journeys (review/diff input, visual result) execute the
  full packaged V2 flagship against fake gateway/MCP fixtures.
- Execution semantics (map decisions, enforcement, convergence limits,
  selection, thresholds, approval binding, snapshot ordering) are unchanged,
  except for two bugs the plumbing exposed and fixed: the Project Mapper's
  wire schema violated the portable strict-JSON subset, and V2 builder
  proposals lacked `expectedBaseHash` on modified files, which made every
  modifying apply fail its integrity gate.
