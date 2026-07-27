# Advanced Artifact System

**Date:** 2026-07-27
**Status:** Accepted
**Stage:** 22

## Context

`ArtifactRef` carried an id, a type, a metadata bag and an optional
`ArtifactLineage`. That was enough to *name* an artifact but not to treat it as
a first-class entity:

- there was no artifact record independent of the reference a capability
  happened to return, so identity had no home;
- there was no version concept at all — re-emitting an artifact silently meant
  "the same thing";
- `ArtifactLineage.parents` was a flat, unvalidated id list stored on each ref.
  Nothing checked that a parent existed, nothing forbade `A → B → A`, and
  reconstructing a chain meant walking every ref that had ever been seen;
- relationships had no vocabulary — "derived from" and "validated by" were
  indistinguishable;
- provenance was per-ref and therefore lost whenever a ref was rebuilt from a
  checkpoint.

§2.5 of the constitution requires immutable, content-addressed artifacts with
total traceability. This stage makes the artifact itself the tracked entity.

## Decision

### 1. The registry is a separate contract from the store

```
ArtifactStore        payload bytes: save / get / exists
      |
      v
ArtifactRegistry     identity / versions / provenance / relations
```

`ArtifactRegistry` (`packages/sdk/src/artifact-system.ts`) declares the six
operations from the stage brief:

```ts
createArtifact(artifact: ArtifactInput): Promise<Artifact>
createVersion(artifactId: string, metadata?): Promise<ArtifactVersion>
getArtifact(id: string): Promise<Artifact | null>
getVersion(artifactId: string, version: number): Promise<ArtifactVersion | null>
addRelation(relation: ArtifactRelation): Promise<void>
getLineage(artifactId: string): Promise<ArtifactLineageGraph>
```

`ArtifactStore` was **extended by composition**, not by adding these six methods
to it:

```ts
export interface RegistryArtifactStore extends ArtifactStore, ArtifactRegistry {}
```

Widening `ArtifactStore` itself was rejected. It would have broken every
existing implementation at once — `LocalArtifactStore` in
`@designflow/artifacts`, the CLI's store wiring, and every test double — and
`@designflow/artifacts` is outside this stage's scope. More importantly it
would force a payload-only backend (S3, GCS, a filesystem) to implement lineage
in order to remain a valid store, which inverts the layering the brief asks for.
The registry half stays optional; `RegistryArtifactStore` is the type for a
backend that provides both.

The registry contract carries **no payload operations**. This is what keeps
"large payload storage abstract": a registry implementation never has to hold
bytes, and the engine's lineage bookkeeping never touches them.

### 2. Immutability is enforced structurally, not by convention

Version records are immutable in the strong sense:

- everything written into the store is `structuredClone`d first, so a caller
  mutating the object it passed in cannot reach stored state;
- everything handed out is recursively `Object.freeze`d, so mutating a returned
  `Artifact` or `ArtifactVersion` throws in strict mode (all ESM is strict).

`createVersion` never rewrites an existing record. The one field that does
change is `Artifact.version` — the **latest-version pointer** on the identity
record — and it advances by replacing the frozen artifact header with a new
frozen one. `Artifact.metadata` is the identity's metadata and is fixed at
registration; per-revision metadata belongs on the version record.

### 3. Version hashes are content-derived and order-independent

`ArtifactVersion.hash` is `SHA-256` over a canonical JSON encoding of
`{ artifactId, version, metadata }`, with object keys sorted recursively
(`canonicalize`). Two structurally equal metadata objects therefore hash
identically regardless of key insertion order, and the same metadata under a
different artifact or version number does not collide.

The algorithm stays internal to the implementation — the contract exposes
`hash: string` only, per §4.4's "generic content-addressable identifiers".

### 4. Cycles are rejected per relation type

`addRelation` rejects, in order:

| Condition | Error | Code |
|---|---|---|
| source `===` target | `ArtifactCycleError` | `ERR_ARTIFACT_CYCLE` |
| source not registered | `ArtifactNotFoundError` | `ERR_ARTIFACT_NOT_FOUND` |
| target not registered | `ArtifactNotFoundError` | `ERR_ARTIFACT_NOT_FOUND` |
| identical edge already present | — (no-op, no event) | — |
| target already reaches source **via the same relation type** | `ArtifactCycleError` | `ERR_ARTIFACT_CYCLE` |

Cycle detection is scoped to a single relation type deliberately. Checking
across all types would reject a legitimate and common pair:

```
new  derived_from  old      // the new artifact came from the old one
old  replaced_by   new      // and the old one was superseded by it
```

Those are two views of one supersession, not a contradiction. Two opposing
edges of the *same* type — `A derived_from B` and `B derived_from A` — are
contradictory, and that is exactly what is rejected. Detection is transitive
(`A → B → C → A` is caught) via a breadth-first search from the proposed target
back to the proposed source; the resulting path is attached to the error as
`cyclePath`.

### 5. Lineage is a graph query, not stored denormalised state

`getLineage(id)` returns:

```ts
{ artifactId, nodes, relations, ancestors, descendants }
```

Edges read source-first: `A derived_from B` points A at its origin B. So
`ancestors` follows edges **forward** (toward origins) and `descendants`
follows them **backward** (toward what was built from this artifact), both
breadth-first and nearest-first. `nodes` is every connected artifact including
the subject; `relations` is every edge with both endpoints in `nodes`.

This supports the target chain directly:

```
Figma JSON  <--derived_from--  UI IR  <--generated_from--  Generated Code
                                             ^
                                             |
                                        derived_from
                                             |
                                     Validated Patch
```

`getLineage("validated-patch").ancestors` → `["generated-code", "ui-ir", "figma-json"]`.

`getLineage` on an unregistered artifact throws `ERR_ARTIFACT_NOT_FOUND` rather
than returning an empty graph — an empty graph is a meaningful answer for an
isolated artifact and must not be confused with a typo.

### 6. The engine resolves, then registers

`ExecutionEngine` detects registry capability at construction:

```ts
this.artifactRegistry = isArtifactRegistry(artifactStore) ? artifactStore : undefined;
```

`isArtifactRegistry` is a runtime type predicate checking the six registry
methods. This was chosen over adding a seventh positional constructor argument:
the constructor already takes six, and every call site that already passes a
registry-backed store gets the behaviour with no signature change. A
payload-only store leaves the engine's behaviour byte-for-byte as before.

After a capability returns, for each produced `ArtifactRef`:

1. `getArtifact(ref.id)` — if present, **resolve** (no new version);
2. if absent, `createArtifact` with provenance
   `{ executionId, workflowId, capabilityId }`;
3. for each in-scope predecessor artifact that is itself registered, add
   `derived_from` from the new artifact to it.

Re-emitting an existing artifact does **not** create a version. Content-addressed
identity means identical id implies identical content, so a second sighting is
the same artifact, and its provenance stays that of the execution that first
produced it. Versioning is an explicit act (`createVersion`), never an
inference. Self-relations and relations to unregistered predecessors are
skipped rather than raised, so an execution seeded with external artifact
references still runs.

### 7. Events

Three new `ExecutionEventType` members go through the existing
`ExecutionEventPublisher`:

| Event | Payload |
|---|---|
| `artifact.created` | `{ artifactId, version: 1 }` |
| `artifact.version_created` | `{ artifactId, version }` |
| `artifact.relation_added` | `{ artifactId, targetArtifactId, relation }` |

`createArtifact` emits **both** `artifact.created` and
`artifact.version_created` for version 1, so a subscriber materialising a
version index never has to special-case an artifact's first version.

Events are attributed to the execution named by the artifact's **provenance**.
An artifact registered outside any execution has no provenance and therefore
publishes nothing — `ExecutionEvent.executionId` is required, and inventing a
placeholder id would corrupt any per-execution event query. Relation events are
attributed to the source artifact's provenance, falling back to the target's.

`artifact.relation_added` carries the edge's target and type in addition to the
`{ artifactId, version? }` shape from the brief; without them the event cannot
be acted on.

### 8. Payloads never enter checkpoints

Unchanged and now explicit: checkpoints persist `ArtifactRef` arrays only
(`appliedArtifacts`, `completedArtifacts`, `childArtifacts`). The registry
holds identity, versions, provenance and relations; payload bytes stay behind
`ArtifactStore.save`/`get`. `InMemoryArtifactStore` keeps its payload map
strictly separate from its registry maps, so replacing it with an
object-storage backend touches only `save`/`get`/`exists`.

## Consequences

- `packages/sdk/src/artifact-system.ts` is new; `ArtifactStore` and
  `ExecutionEventType` are extended additively.
- `packages/core/src/artifacts/` is new: `InMemoryArtifactStore`,
  `isArtifactRegistry`, and the `immutability` helpers.
- Core gained three error classes: `ArtifactNotFoundError`,
  `ArtifactConflictError`, `ArtifactCycleError`.
- The pre-existing `artifactLineageSchema` / `ArtifactRef.lineage` is retained.
  It is now the *transport* shape (what a capability declares at save time);
  the registry is the *system of record*. `InMemoryArtifactStore.save`
  translates one into the other. Collapsing them was deferred to avoid a
  breaking change to `ArtifactStore.save` in this stage.
- Relation and lineage queries are linear scans over the relation list. That is
  correct and adequate for an in-memory reference implementation; a persistent
  backend will want indices.

## Migration Notes

### Nothing is required

Every existing `ArtifactStore` implementation, capability, workflow and test
double continues to work unchanged. The registry is opt-in: an engine
configured with a payload-only store behaves exactly as it did before this
stage — no registration, no artifact events.

### To opt in

Pass a registry-backed store where the engine expects an `ArtifactStore`:

```ts
import { ExecutionEngine, InMemoryArtifactStore } from "@designflow/core";

const artifactStore = new InMemoryArtifactStore({ eventPublisher });

const engine = new ExecutionEngine(
  registry, logger, artifactStore, executionRepository, eventPublisher,
);
```

The engine detects the registry automatically. `ExecutionServiceConfig.artifactStore`
accepts the same value with no config change.

### For hosts rendering execution events

Handle the three new `artifact.*` types, or filter on the `execution.` /
`capability.` / `workflow.` prefixes. `executionEventTypeSchema` is an enum, so
an unhandled member is a type error at the switch, not a silent fallthrough.

### For authors of a new storage backend

Implement `ArtifactStore` alone for payload-only backends. Implement
`RegistryArtifactStore` to participate in identity, versioning and lineage; the
behaviours the engine relies on are:

- `createArtifact` rejects a duplicate id with `ERR_ARTIFACT_EXISTS`;
- `getArtifact` returns `null` (never throws) for an unknown id;
- `addRelation` is idempotent for an identical edge;
- `addRelation` rejects unregistered endpoints and same-type cycles.

`packages/core/src/artifacts/in-memory-artifact-store.test.ts` is the contract
suite to run a new backend against.

### `@designflow/artifacts`

`LocalArtifactStore` is untouched and remains a valid `ArtifactStore`. Giving it
a persistent registry is a follow-up; it is out of this stage's scope, which was
limited to `packages/sdk` and `packages/core`.
