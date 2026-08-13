# ADR: UI Builder and Implementation Map enforcement

Status: accepted for Agent Architecture V2, phase V2-4. The flagship workflow
is unchanged; the legacy Implementation Agent remains the public path.

## Decision

The UI Builder (`packages/agents/src/ui-builder/`) is V2's code-producing
agent. It executes an Implementation Map — it does not plan one.

```
UIBlueprint + ImplementationMap + ProjectContext
        ↓ compileUIBuilderEvidence   (host-selected sources only)
    UI Builder  →  ProposedFileChanges
        ↓ enforceImplementationMap   (the plan is binding)
        ↓ checkReachability          (a screen nobody can open is a failure)
        ↓ deriveBuilderCoverage      (host-derived, never declared)
        ↓ proposed-state build       (injected, existing machinery)
    valid proposal
```

Nine commitments:

1. **The Builder executes the Implementation Map.** Reuse/extend/create, the
   destination, the composition root, style and asset strategies are input.
2. **The Builder does not plan architecture.** An attempt that switches reuse
   to create fails enforcement rather than being accepted.
3. **Blueprint remains design truth.**
4. **ProjectContext remains project truth.**
5. **Map decisions are immutable across attempts.** Repair feedback says "fix
   your implementation"; the plan is restated as immutable in every request.
6. **The host chooses the source context.** Files come from the map, reuse
   targets are read-only, and there is no filesystem tool.
7. **The host validates map compliance**, with eight typed violation codes.
8. **Invalid proposals never reach approval.** Three bounded attempts, then a
   typed failure with history and zero writes.
9. **Repair Mode is a mode of this agent** (`mode: "initial" | "visual_repair"`),
   so V2-6 does not need a second code-writing agent.

## Why enforcement is deterministic

The legacy path asked the model to declare its own coverage. A model that
failed to implement something is the worst available judge of whether it did,
and the field showed the specific consequence: components that existed and a
page nobody could open. Coverage and reachability are therefore computed from
the map's requirements and the proposal's contents, and the model's opinion is
not consulted anywhere in `builder-pipeline.ts`.

## Measurements (Spendly fixture)

Request 7,495 bytes without source excerpts, 12,407 with them (~3.1k tokens),
5 selected files. Proposal 2,289 bytes (~573 output tokens); a doubled
multi-component page ~1,101; a single small component ~112. `maxOutputTokens`
is **6000** — ~5× the measured worst case, chosen for real component bodies
rather than copied from the legacy 16k value.

## What this deliberately does not do

- No approval movement: V2-4 ends at a validated proposal in isolated
  proposed state. Visual refinement (V2-5/6) comes before approval later.
- No fifth fingerprint verification. `builder-pipeline.ts` compares the map's
  recorded fingerprint to the compiled context and reports `stale_project`; it
  does not re-implement approval's check. The consolidation of the existing
  four remains a V2-7 prerequisite.
- No workflow capability wiring. The chain is proven by an in-package
  composition (Blueprint → ProjectContext → Map → Builder → validation) in
  tests; persisting the canonical artifacts through capabilities lands with
  the flagship migration, where the artifact ids already declared by V2-1/2/3
  become real.

## Consequences

- The proposal contract gains an optional `v2Binding` (Blueprint, Map,
  ProjectContext refs, fingerprint, builder provenance, attempt). Legacy
  proposals carry none of it and stay valid.
- `ImplementationMapUnexecutableError` distinguishes "the Builder failed" from
  "this plan cannot be executed against this project" — the signal a future
  Mapper↔Builder refinement loop will consume. That loop is not built here.
