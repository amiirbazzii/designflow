# Artifact Intelligence Layer

**Date:** 2026-07-27
**Status:** Accepted
**Stage:** 23

## Context

Stage 22 made artifacts first-class entities with identity, immutable
versions, provenance and typed relations. The graph is complete but inert:
`getLineage` returns a raw subgraph and every consumer would have to re-derive
the same four answers from it.

The graph should answer, directly:

1. What depends on this artifact?
2. What should be invalidated after a change?
3. Which workflows can reuse previous work?
4. Which executions need rerunning?

There is also no point at which the engine can decline to redo work it has
already done. Every capability runs unconditionally, even when its inputs and
dependencies are byte-identical to a previous run.

## Decision

### 1. Intelligence is layered over the registry, not baked into it

`ArtifactIntelligence` (`packages/sdk/src/artifact-intelligence.ts`) declares
the five query operations. `ArtifactIntelligenceService` (core) implements it
over any `ArtifactRegistry` handed to its constructor.

Adding the methods to `ArtifactRegistry` itself was rejected for the same
reason as Stage 22's `RegistryArtifactStore`: it would break every existing
registry implementation, and it would force a backend that merely *stores*
lineage to also implement analysis over it. `IntelligentArtifactRegistry
extends ArtifactRegistry, ArtifactIntelligence` names a backend that does both.

The service holds **no state**. Every answer is derived from the registry's
lineage graph at call time, so it can never disagree with the registry and
there is no cache to invalidate. That is also why it composes over
`ArtifactRegistry` rather than being a method on `InMemoryArtifactStore` — the
analysis is backend-independent.

### 2. Dependency direction excludes supersession

Stage 22 split relations into a lineage scope (`derived_from`,
`generated_from`, `validated_by`) and a supersession scope (`replaced_by`).
Intelligence traversal follows **lineage relations only**, now shared from
`packages/core/src/artifacts/relations.ts`.

`ArtifactRegistry.getLineage` deliberately still returns the whole connected
subgraph including `replaced_by` — it is the raw graph. The service filters,
because a replacement is not something an artifact was *built from*. Following
`replaced_by` would report an artifact's successor as its dependency and would
make a supersession look like an impact.

Reading edges source-first (`A derived_from B` points A at its origin B):

| Query | Direction |
|---|---|
| `dependencies` | source → target, breadth-first, nearest first |
| `dependents` | target → source, breadth-first, nearest first |

The two query methods are **directional**. `getDependencies` populates
`dependencies` and leaves `dependents` empty; `getDependents` does the reverse.
Both return the full `ArtifactDependency` shape the schema specifies, but each
answers only the question it was asked.

Having both return the same fully-populated record was rejected: it makes the
two methods indistinguishable at runtime, so a caller that reached for the
wrong one would still get a plausible answer and never learn it had asked the
wrong question. The combined view is still available — `analyzeImpact` builds
it internally, and a caller wanting both directions makes both calls.

An empty array therefore means "nothing in this direction *as asked*", not
"nothing exists". Callers wanting the full picture must call both.

### 3. Impact is scoped to what is downstream

`analyzeImpact(artifactId, version?)` returns the artifact's dependents as
`affectedArtifacts`, then resolves `affectedWorkflows` and
`affectedExecutions` from the **provenance of those affected artifacts** —
not the subject's own.

This is the answer to "which executions need rerunning". The execution that
produced the changed artifact has already run; what is now stale is the work
built on top of it. An execution that produced both the subject and something
downstream still appears, via the downstream artifact.

Affected artifacts with no provenance (registered outside any execution)
contribute nothing rather than being skipped from `affectedArtifacts` — they
are genuinely invalidated, there is simply no execution to rerun.

`version` is validated when supplied and rejected with
`ERR_ARTIFACT_VERSION_NOT_FOUND` if it does not exist, so an impact report can
never be attributed to a revision that never existed. It does not change the
result: the relation graph is between artifacts, not between versions, so the
impact set is the same for any version of the subject. Per-version impact would
require version-level edges, which is a larger change than this stage.

### 4. Diff is key-level and canonical

`diffVersions(artifactId, fromVersion, toVersion)` compares the two version
records' metadata:

| Bucket | Meaning |
|---|---|
| `added` | key in `toVersion` only |
| `removed` | key in `fromVersion` only |
| `modified` | key in both, values canonically unequal |

Values are compared with `contentEquals` (canonical encoding), so a reordered
nested object is not reported as modified. Buckets are sorted, so the output is
deterministic.

`changed` is taken from the version **hashes**, not from whether the buckets
are empty. Stage 23's fix to Stage 22 made those hashes content-derived and
version-number-independent, so equal hashes mean equal content — a cheaper and
more authoritative check than re-deriving equality from the diff.

`metadataChanges` is optional in the schema but **always populated** by this
implementation, including when nothing changed. A conditionally-absent field
would force every consumer to branch.

Both versions must exist; either side missing raises
`ERR_ARTIFACT_VERSION_NOT_FOUND`.

### 5. Reuse detection needs the version the caller observed

The brief's rule is "same artifact id AND same version = reusable; changed
version: not reusable". That is not decidable from ids alone — an id says
nothing about which revision the caller last saw. `findReusableArtifacts`
therefore takes `readonly ArtifactVersionRef[]`:

```ts
{ artifactId: string, version?: number }
```

`version` is optional; omitting it asks only whether the artifact still exists.
This is the one place the stage brief's literal signature was widened, and it
is the minimum needed to make the stated rule answerable.

The report is per-candidate with an explicit reason, so a caller can tell *why*
reuse was refused:

| `reason` | Meaning |
|---|---|
| `unchanged` | registered, still at the observed version |
| `missing` | not registered |
| `version_changed` | registered, but has advanced past the observed version |

`allReusable` is false for an empty request. "Nothing to reuse" is not the same
as "everything is reusable", and a cache keyed on the latter would skip work it
had never done.

### 6. The engine gets a decision boundary, not a cache

`CapabilityReuseResolver` is a single-method SDK interface. Before running a
capability, `ExecutionEngine` builds a `CapabilityReuseRequest`:

```ts
{ executionId, workflowId, nodeId, capabilityId, inputFingerprint, dependencies }
```

- `inputFingerprint` is `hashContent` over the node's **resolved** input, so
  identical input fingerprints identically across executions and key order does
  not matter.
- `dependencies` are the artifacts the node would consume, each at its current
  registered version — exactly the input `findReusableArtifacts` expects.

If the resolver answers `reuse: true`, the engine validates the decision (see
below), emits `artifact.reused` per adopted artifact, and returns the node as
**executed** with those artifacts. Only the capability body is skipped; the
node still completes and still feeds downstream nodes.

**The resolver owns policy; the engine owns integrity.** A reused artifact is
adopted, never registered, so an adopted id that does not exist would put a
dangling reference into the DAG and into every downstream node's lineage —
cache poisoning with no later checkpoint to catch it. Before honouring a
decision the engine rejects any adopted artifact the registry does not know,
with `ExecutionError` naming the offending id.

The whole set is validated before any event is published, so a partly valid
decision leaves no trace rather than emitting `artifact.reused` for the good
half of a bad answer. A rejected decision fails that node — downstream nodes
block as dependents of a failed step — rather than aborting the run: one bad
cache entry is a node-level fault, not a structural one.

Validation is skipped when the configured store is payload-only, since there is
no registry to check against. Such a host is already outside the artifact
system's guarantees; reuse is taken on trust rather than blocked outright.

**Core ships no resolver.** Deciding what may be reused, and where prior
outputs live, is caching policy that belongs to the host — implementing it here
would be the "full cache engine" the brief excludes. With no resolver
configured the engine's behaviour is byte-for-byte what it was before this
stage; nothing is ever skipped unless a host opts in.

A reused node does **not** register an artifact or create a version. Reuse
adopts a prior artifact; it never claims to have produced one.

`hashContent` moved to `packages/core/src/artifacts/hashing.ts` so version
hashing and input fingerprinting share one definition of "same content". Two
implementations that could drift apart is exactly the bug that makes a cache
unsafe.

### 7. Events

| Event | Payload | Attributed to |
|---|---|---|
| `artifact.impact_analyzed` | `{ artifactId, affectedCount, version? }` | subject's provenance |
| `artifact.diff_created` | `{ artifactId, fromVersion, toVersion, changed }` | subject's provenance |
| `artifact.reused` | `{ artifactId, version?, executionId, nodeId, capabilityId, reason? }` | the running execution |

The first two follow Stage 22's rule: analysis of an artifact registered
outside any execution publishes nothing, because `ExecutionEvent.executionId`
is required and inventing a placeholder would corrupt per-execution queries.
`artifact.reused` has no such problem — it is emitted from inside a live
execution.

## Consequences

- `packages/sdk/src/artifact-intelligence.ts` is new. `ExecutionEventType`
  gained three members additively.
- `packages/core/src/artifacts/` gained `intelligence.ts`, `relations.ts` and
  `hashing.ts`; the latter two are extractions from
  `in-memory-artifact-store.ts`, which is otherwise unchanged in behaviour.
- Core gained `ArtifactVersionNotFoundError`
  (`ERR_ARTIFACT_VERSION_NOT_FOUND`).
- `ExecutionEngine`'s constructor gained a **seventh** optional positional
  parameter. Seven positionals is past the point where an options object would
  be better; that refactor is deferred because it is a breaking change to every
  call site and unrelated to this stage's goal.
- Traversal and diff are linear scans over the lineage subgraph, adequate for
  an in-memory reference implementation. A persistent backend will want
  indices.
- `analyzeImpact` reports impact per artifact, not per version.

## Migration Notes

### Nothing is required

Every existing store, registry, capability, workflow and engine call site works
unchanged. Both additions are opt-in: intelligence is a service you construct,
and the reuse boundary is inert without a resolver.

### To query the graph

```ts
import { ArtifactIntelligenceService, InMemoryArtifactStore } from "@designflow/core";

const registry = new InMemoryArtifactStore({ eventPublisher });
const intelligence = new ArtifactIntelligenceService({ registry, eventPublisher });

await intelligence.getDependencies("validated-patch");
await intelligence.analyzeImpact("ui-ir");
await intelligence.diffVersions("ui-ir", 1, 2);
await intelligence.findReusableArtifacts([{ artifactId: "ui-ir", version: 1 }]);
```

`eventPublisher` is optional; omit it to query without emitting events.

### To enable capability reuse

Implement `CapabilityReuseResolver` and pass it as
`ExecutionServiceConfig.reuseResolver` (or the engine's 7th argument):

```ts
const reuseResolver: CapabilityReuseResolver = {
  async resolve(request) {
    const previous = cache.get(request.capabilityId, request.inputFingerprint);
    if (previous === undefined) return { reuse: false, artifacts: [] };

    const report = await intelligence.findReusableArtifacts(request.dependencies);
    return report.allReusable
      ? { reuse: true, artifacts: previous.artifacts, reason: "cache hit" }
      : { reuse: false, artifacts: [] };
  },
};
```

Two obligations on an implementer:

- **Answer `reuse: false` when unsure.** A false positive silently skips real
  work; a false negative only costs time.
- **Return artifacts that already exist.** The engine adopts them without
  registering them, so an unknown id is rejected with `ExecutionError` and the
  node fails. This is enforced, not advisory.

`request.dependencies` is already in the shape `findReusableArtifacts` accepts,
so the dependency half of the decision is one call.

### For hosts rendering execution events

Handle the three new `artifact.*` types. `executionEventTypeSchema` is an enum,
so an unhandled member is a type error at the switch rather than a silent
fallthrough.

### For implementers of `ArtifactIntelligence`

`getDependencies` and `getDependents` must be directional — each populates its
own field and leaves the other empty. Traversal must exclude `replaced_by`, or
a successor will be reported as a dependency. `findReusableArtifacts` must
treat an empty request as `allReusable: false`.
