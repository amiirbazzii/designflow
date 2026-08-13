# ADR: Project Mapper and the Implementation Map

Status: accepted for Agent Architecture V2, phase V2-3. The flagship workflow
is unchanged; the legacy Project Analysis capability keeps running exactly as
before, and nothing here is wired into `design-to-code-implementation`.

## Decision

`ImplementationMap` (`packages/sdk/src/implementation-map/`, schemaVersion 1)
is the design-to-project decision record, produced by the Project Mapper
(`packages/agents/src/project-mapper/`) from the two canonical V2 inputs:

```
UIBlueprint (design truth) + CanonicalProjectContext (project truth)
                          ↓
                   ImplementationMap
```

Nine commitments:

1. **Blueprint is design truth.** Requirements are derived from it; a patch
   can neither add nor remove one.
2. **ProjectContext is project truth.** Every candidate, destination,
   directory, token and asset a decision may name comes from it.
3. **ImplementationMap is the decisions** — reuse / extend / create per
   component, where the screen becomes reachable, how foundations map, what
   composes into what.
4. **The mapper does not write code.** No field in the patch or the map can
   hold JSX, CSS, a file body, a patch or a command, and the merge scans
   bounded prose fields for code markers as well.
5. **The mapper cannot invent project facts.** It selects host-minted ids. A
   component the project lacks has no id, so
   `src/components/MyPerfectButton.tsx` cannot be referenced into existence.
   For `create`, the host offers directories and derives the planned path from
   an offered directory plus a name.
6. **The deterministic skeleton owns references.**
   `compileImplementationMapDraft` builds requirements, candidates, planned
   directories, tokens, assets and the binding before any model runs, and a
   fingerprint over all of it must be identical before and after the merge.
7. **AI supplies bounded decisions.** Four stages in dependency order —
   destination, component families (6 definitions per request), foundations,
   composition — each carrying only its own requirements and candidates.
8. **Coverage is explicit and never silent.** Every requirement is `mapped`,
   `intentionally_not_implemented`, `unsupported` or `unresolved`. A truncated
   requirement set reports `truncated`, never `complete`. Component
   definitions and component *instances* are separate requirements, so a
   blanket `reuse` whose slots are incompatible leaves its six instances
   unresolved instead of inheriting a pass.
9. **The map is the Builder's contract** (V2-4), carrying the Blueprint
   version, the ProjectContext version and the project fingerprint it was
   planned against.

## Why decisions and not a regenerated map

The Design Interpreter established the shape: a deterministic host owns every
reference, and the model returns a small patch of judgments keyed by ids. The
Mapper reuses it exactly. Measured on the Spendly fixture: the largest request
is 5,744 bytes (~1,436 tokens), the worst-case patch 4,281 bytes (~1,071
tokens) against a configured 2,500-token budget, and the model never
regenerates the 7,116-byte skeleton it was given. Asking for the whole map
back would triple the output for no added judgment and reintroduce exactly the
truncation failure mode the legacy Specification path shipped with.

## Fingerprint binding, and what this deliberately does not do

The map *carries* `projectFingerprint`; it does not verify it. Fingerprint
equality is already checked in four places across three packages
(`verifyApproval`, two inline checks in
`implementation-side-effect-capabilities.ts`, and `execution-service.ts` on
untyped casts). Adding a fifth would make the eventual consolidation harder.

**Recorded debt, to be resolved before V2-7 pre-approval convergence:**
consolidate those four into one authoritative binding-verification path. V2-7
re-checks project drift on every convergence iteration, which is precisely
where four copies stop agreeing.

**Recorded store-level debt (not blockers, not fixed here):**
`ProjectFact.expiresAt` is stored but never enforced; `patchFacts` does not
apply the 40,000-character total cap that the fresh-context path does; and
`ProjectContextTooLargeError` is also thrown for merge-retry exhaustion.

## Legacy Project Analysis migration

| Legacy behavior | V2 owner |
| --- | --- |
| `inspect-registered-project` filesystem facts | ProjectContext compiler (V2-2) |
| `map-design-system` name-similarity token/component matching | Project Mapper — as *candidates* (deterministic) plus *judgment* (AI); the deterministic 0.8 threshold that produced `manual-review` is replaced by candidate scores plus an explicit compatibility model |
| `deriveImplementationCoveragePlan` required targets | `ImplementationMap.coverage`, derived from Blueprint requirements rather than from the spec hierarchy's root frame, and instance-aware |
| `store-implementation-plan` reuse/extend/create lists | `ImplementationMap.components` |
| Model-declared `coverageClaims` | Coverage derived from decisions, not declared by the model |

Nothing is deleted in this phase; the flagship keeps using the legacy path
until the Builder (V2-4) can execute a map.

## Consequences

- Mapper decisions are design-specific and are **never** written to the
  durable `ProjectFact` store, which holds project truth only.
- Candidate sets are bounded at 5 per requirement, requirements at 300, with
  `discoveredCount` / `retainedCount` / `selectionRule` recorded whenever a
  bound bites.
- Heuristic ProjectContext facts stay marked heuristic in the model-facing
  evidence, so a guessed design-system directory never reads as certainty.
