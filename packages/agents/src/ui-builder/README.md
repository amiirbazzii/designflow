# UI Builder

**Purpose** — execute an already-decided Implementation Map as bounded code
changes.

```
UIBlueprint + ImplementationMap + ProjectContext
                    ↓
                UI Builder
                    ↓
        bounded ProposedFileChanges
                    ↓
   map enforcement → reachability → coverage → proposed-state build
```

1. **The Builder executes; it does not plan.** Reuse/extend/create, the
   destination, the composition root, style and asset strategies were decided
   by the Project Mapper and arrive as immutable input.
2. **Blueprint remains design truth**, **ProjectContext remains project
   truth**, and neither is re-derived here.
3. **The host chooses the source context.** `selectBuilderSourcePaths` derives
   the readable files from the map itself; there is no filesystem tool. Reuse
   targets are readable and *not* writable.
4. **The host validates map compliance.** `enforceImplementationMap` rejects a
   created substitute for a reused component, a modified reuse target, a
   missing extension, an unauthorized file, a wrong destination, a dropped
   token and an unreferenced mapped asset.
5. **Coverage is derived, never declared.** A model statement that it covered
   the design carries no authority; `deriveBuilderCoverage` checks the map's
   own requirements — including each instance's evidenced copy — against the
   proposal.
6. **Reachability is checked, not asked.** A screen whose components exist but
   which nothing mounts fails before review; this was a real field failure.
7. **Invalid proposals never reach approval.** Three bounded attempts (the
   limit the legacy loop already had), each receiving the same immutable plan.
8. **Repair Mode is the next mode, not the next agent.** `mode` exists from
   day one so V2-6 adds visual repair here instead of keeping a second
   code-writing agent alive.

| File | Responsibility |
| --- | --- |
| `ui-builder-agent.ts` | the agent: manifest, `ui-builder-default` profile, strategies, wire→proposal normalization |
| `builder-evidence-compiler.ts` | the bounded model-facing request |
| `builder-source-selection.ts` | which files may be read, and which may be written |
| `map-enforcement.ts` | every map violation, typed |
| `builder-coverage.ts` | host-derived coverage and reachability |
| `builder-pipeline.ts` | the bounded 3-attempt build and its typed outcomes |
| `repair-context.ts` | bounded deterministic repair feedback |
| `builder-report.ts` | deterministic human-readable result |

**Does not own** — approval, apply, rollback, or any filesystem write. Those
stay in `@designflow/capability-implementation`, unchanged.

**Migration status** — the legacy Implementation Agent
(`../implementation/`) remains the flagship path until the public migration;
the two never operate in the same proposal path.

**Tests** — `./test/`.
