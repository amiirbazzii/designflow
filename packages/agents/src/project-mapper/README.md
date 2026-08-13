# Project Mapper

**Purpose** — decide how an already-compiled design is realized inside an
already-inspected project.

```
UIBlueprint (design truth) + CanonicalProjectContext (project truth)
                          ↓
                   ImplementationMap
```

1. **Blueprint is design truth.** Requirements are derived from it; a patch
   can neither add nor remove one.
2. **ProjectContext is project truth.** Candidates, destinations, directories,
   tokens and assets all come from it.
3. **ImplementationMap is the decisions** — reuse / extend / create, where the
   screen becomes reachable, how foundations map, what composes into what.
4. **The mapper does not write code.** No field in the patch or the map can
   hold JSX, CSS, a file body or a command.
5. **The mapper cannot invent project facts.** It selects host-minted ids;
   a component the project lacks has no id to name.
6. **The deterministic skeleton owns references.** `compileImplementationMapDraft`
   builds requirements, candidates and bindings before any model runs.
7. **AI supplies bounded decisions.** Staged per destination / component
   family / foundations / composition, each request carrying only its own
   requirements and candidates.
8. **Coverage is explicit.** Every requirement is `mapped`,
   `intentionally_not_implemented`, `unsupported` or `unresolved`; a truncated
   requirement set can never report `complete`. Component definitions and
   component *instances* are separate requirements, so a blanket `reuse`
   cannot hide an instance the component can't express.
9. **The map is the Builder's contract** (V2-4): it executes the plan without
   re-deciding the architecture.

| File | Responsibility |
| --- | --- |
| `mapping-skeleton.ts` | Blueprint + ProjectContext → deterministic draft (requirements, candidates, binding) |
| `candidate-builder.ts` | deterministic candidate discovery, scoring and bounding |
| `partitioner.ts` | splits the draft into bounded, ordered mapping requests |
| `evidence-compiler.ts` | the compact model-facing view of one partition |
| `project-mapper-agent.ts` | the agent: manifest, model profile, strategies |
| `mapping-patch-response-schema.ts` | portable provider wire shape for one patch |
| `mapping-patch-merge.ts` | validates and merges decisions; owns every rejection code |
| `mapping-report.ts` | deterministic human-readable view of a map |

Contracts live in `@designflow/sdk` under `src/implementation-map/`.

## Tests

Runtime source: this directory.
Feature tests, fixtures and helpers: `./test/`.
