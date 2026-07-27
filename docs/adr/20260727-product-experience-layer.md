# Product Experience Layer

**Date:** 2026-07-27
**Status:** Accepted
**Stage:** 27

## Context

Stages 1–26 built an engine that is technically complete: it compiles DAGs,
executes capabilities, versions artifacts, plans incrementally, reuses prior
work and reconciles the result.

None of that is legible. Asking "why did this workflow produce this result?"
means reading `ExecutionRecord.status`, correlating `LifecycleEvent` rows,
opening the latest checkpoint's `appliedArtifacts`, and knowing that
`execution.reconciled` carries the added/reused/removed counts. Every consumer
that wants to show a run to a person would rebuild that correlation, and each
would drift from the engine differently.

## Decision

### 1. A separate package, so the boundary is enforced rather than intended

`@designflow/product` is new, and it depends on **`@designflow/sdk` only** —
not on `@designflow/core`.

Putting the read model inside core would have made "the product layer must not
inspect engine internals" a convention that the next contributor could quietly
break. A package boundary makes it a compile error, which is how this repo
already enforces its layering (§5.1's import matrix).

```
@designflow/core   ──emits──▶  events, records, artifacts
                                        │
                                        ▼
                             @designflow/product      (read-only)
                                        │
                                        ▼
                                UI / API / CLI
```

The layer holds no execution state, performs no work, and imports nothing from
core. Everything it returns is derived on demand from what the engine already
records.

**This adds a row to the constitution's import matrix (§5.1) that is not yet
written there:** `@designflow/product` may import `@designflow/sdk`, and must
never import Core, State, Artifacts, Workflows or the CLI. The CLI may import
it.

### 2. The product layer keeps its own event read model

`ExecutionEventRepositorySubscriber` persists only events that map to a
lifecycle phase. Its `EVENT_TO_PHASE` table has no entry for any `artifact.*`
event, nor for `execution.plan_created` or `execution.reconciled` — precisely
the events that explain what a run reused, planned and changed. Those are
published and then dropped.

Rather than widen the engine's persistence (which would put presentation
concerns into the recovery boundary), `InMemoryExecutionEventCollector`
subscribes to the same `ExecutionEventPublisher` and keeps the raw stream.

It is a *read model*, not a second source of truth: it stores what the engine
broadcast, never interprets or acts on it, and losing it loses presentation
detail rather than execution state.

### 3. Narration is additive and lossy on purpose

`narrateEvents` maps the raw stream to sentences. Raw events are untouched and
remain the record of what happened.

Two deliberate losses make the story readable:

- **Silent events.** `artifact.version_created`, `artifact.relation_added`,
  `artifact.materialized` and `capability.started` carry no standalone meaning
  for a reader and are omitted.
- **Aggregation.** Consecutive events of the same type collapse into one
  counted line, so a run that reused eight artifacts reads
  "Reused 8 existing artifacts" rather than eight identical sentences. The line
  is stamped with the *first* event's timestamp, which is when that phase began.

Each narration entry keeps `sourceEventTypes`, so a reader can always get back
to the raw events a line came from.

### 4. The timeline is a projection, not stored state

`buildTimeline` derives from the same narrated events. There is no second store
to keep in sync, so the timeline and the narration can never disagree.

Entries sort by timestamp, but ties **keep publish order**. Events published
within the same millisecond are common (the engine emits several in a row), and
sorting alone would make their order arbitrary — publish order is the order the
work actually happened.

### 5. Counts prefer the engine's own accounting

`countArtifacts` reads the last `execution.reconciled` event when present: that
is the engine's reconciliation report, and it already distinguishes `unchanged`
from `added`, which no amount of event counting can recover.

Only when a run never reconciled (a full, non-incremental execution) does it
fall back to counting `artifact.created` / `artifact.reused` events, where
`unchanged` has no meaning and stays zero. Reuse wins over creation for the
same id: an artifact registered and then adopted was still not recomputed.

### 6. One engine change: the reconciled event now carries removed **ids**

`execution.reconciled` carried `{ added, reused, removed, unchanged }` — counts
only. A removed artifact is by definition absent from the final set and from
the registry's view of this run, so the count was the *only* trace of it and
nothing could name what left.

The event payload now also carries `removedArtifactIds`, which the reconciler
had already computed and discarded.

This is a payload widening, not a behaviour change: reconciliation computes
exactly what it computed before, the result schema is unchanged, and no
decision anywhere depends on the new field. It was the minimum needed for the
product layer to answer "what changed?" rather than "how much changed?".

### 7. `ExecutionState` is not `ExecutionRecordStatus`

The engine's status encodes how a run ended; a reader needs to know what to do
about it. `cancelled` and `failed` both collapse to `failed` — from a user's
point of view both mean the run stopped without a usable result. `completed`
becomes `ready`, `waiting_approval` becomes `needs_approval`.

The raw `status` and a display `statusLabel` are both still reported, so
nothing is hidden.

## Consequences

- `packages/product/` is new: `@designflow/product`, depending only on the SDK.
- `packages/core/src/engine.ts` gained one field in an event payload. No engine
  behaviour, semantics or responsibility changed.
- The constitution's §3 directory listing and §5.1 import matrix do not yet
  mention this package; both need a follow-up edit.
- The collector is in-memory and per-process. A restart loses narration and
  timeline for prior runs; execution state itself is unaffected because it
  lives in the repository. A durable event store is a later stage.
- Presentation strings are English and hardcoded. Localisation would need a
  message-key indirection that is not worth building for one locale.

## Migration Notes

### Nothing is required

No existing package changes behaviour. `@designflow/product` is additive and
opt-in.

### To show executions to a person

```ts
import {
  InMemoryExecutionEventCollector,
  ProductExecutionService,
} from "@designflow/product";

const collector = new InMemoryExecutionEventCollector();
collector.subscribeTo(eventPublisher);   // the same publisher the engine uses

const product = new ProductExecutionService({
  executionRepository,
  eventSource: collector,
  artifactRegistry: artifactStore,          // optional; enables artifact summaries
  resolveWorkflowName: (id) => registry.get(id)?.definition.name,
});

const report = await product.getReport(executionId);
```

`getReport` returns overview, narration, timeline and artifact summaries
together. `getOverview`, `getNarration`, `getTimeline` and `getArtifacts` are
available individually, and `listOverviews(workflowId)` returns a workflow's
runs newest first.

**Subscribe the collector before the execution starts.** It records what it
hears; events published before it subscribed are not recoverable, and the
report for such a run will show an empty narration and timeline while the
overview still resolves from the repository.

### For consumers of `execution.reconciled`

The payload gained `removedArtifactIds`. Existing readers are unaffected —
nothing was removed or renamed. A test asserting the payload with `toEqual`
will need the new field.

### For anyone building a UI, HTTP API or CLI view

Read through `ProductExecutionService`. Do not reach into `ExecutionRepository`,
the artifact registry or the event stream directly: the correlation between
them is what this layer exists to own, and duplicating it is how the product
view starts disagreeing with the engine.
