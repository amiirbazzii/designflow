# Incremental Execution Reconciliation

**Date:** 2026-07-27
**Status:** Accepted
**Stage:** 26

## Context

Stages 24–25 let an incremental run skip nodes and adopt their prior outputs.
What the run *reported* was still a flat list: `candidateArtifacts`, produced
and reused mixed together, in layer order.

That is enough to execute, but not enough to answer the questions a caller of
an incremental run actually has. Which artifacts came from this run's work?
Which were carried over? What did the previous run have that this one no longer
does? And — the safety question — is the merged set even coherent, or does it
name one artifact twice at two different revisions?

Nothing checked the last one. A resolver adopting `code` while a node also
produced `code` would put both into the result, and every downstream consumer
would silently see whichever came first.

## Decision

### 1. Reconciliation is the fourth read-only step

`ExecutionReconciler` (SDK) closes the incremental loop:

| Question | Owner |
|---|---|
| Does this node need computation? | `IncrementalExecutionPlanner` |
| Can we reuse instead of computing? | `CapabilityReuseResolver` |
| Are these artifacts real and usable? | `ArtifactMaterializer` |
| What is this run's final artifact set? | `ExecutionReconciler` |

Like the other three it merges, verifies and counts — it never executes,
decides reuse, plans, or mutates artifact contents.

### 2. The final set is reused ∪ produced

`previousArtifacts` is an input, but it is **not** a source of survivors. An
artifact reaches the result by being reused or produced, never by having been
in the previous run.

This is what makes removal detectable at all. If previous artifacts were
carried forward by default, `removedArtifactIds` could never be non-empty, and
a pipeline that stopped producing something would keep reporting it forever.

`removedArtifactIds` is keyed on **id**, not identity: an artifact that
advanced from `v1` to `v2` did not leave, it changed.

### 3. `ArtifactRef` gained an optional `version`

Reconciliation identity is `id + version`, and `ArtifactRef` could express only
the id half. Resolving a *previous* reference against the registry returns
whatever is current — so a previous `code:v1` resolved to `code@2` and compared
equal to the artifact that had just replaced it. The first draft of this stage
did exactly that, and the worked example from the brief reported
`added: 0, unchanged: 1` instead of `added: 1, unchanged: 0`.

A reference recorded by a past run has to be able to say which revision it
meant. `version` is therefore `.optional()` — never `.default()`, which would
make it a required property of every existing typed reference (the lesson from
Stage 24's `produces`).

`resolveVersions` takes a reference at its word when it names a version, and
falls back to the registry only for unversioned ones. `reconcile` stamps the
resolved version onto every artifact it returns, so the set a run records as
`appliedArtifacts` is readable as the next run's `previousArtifacts` without
losing identity across the round trip.

### 4. Two classes of conflict, both fatal

| Kind | Condition |
|---|---|
| `duplicate_identity` | the same `id + version` appears twice in the merged set |
| `ambiguous_version` | one id appears at two different versions in the merged set |
| `content_conflict` | a produced artifact claims a prior identity with different metadata |

`ambiguous_version` is the one the brief did not name and the one that matters
most in practice: a dependent reading a set containing both `code@1` and
`code@2` cannot tell which revision it is meant to consume. Duplicate identity
is merely redundant by comparison.

`content_conflict` enforces what `id + version` is supposed to mean. A node
that ran again and emitted the same version must have emitted the same
artifact; if the metadata differs, either the version should have advanced or
the content should not have. Comparison is canonical, so reordered keys are not
a conflict.

All three raise `ArtifactReconciliationError`
(`ERR_ARTIFACT_RECONCILIATION_FAILED`) carrying every conflict, not just the
first.

### 5. `reused` is checked before `added` in the report

The four counters must partition the result, so classification needs a
precedence. `reused` wins.

`reused` describes *how an artifact arrived*; `added` and `unchanged` describe
*whether the set changed*. Classifying an adopted artifact by whether the
previous run happened to hold it would make the count depend on history rather
than on what this run did — an artifact reused from two runs ago would report
as `added`, which is the opposite of true.

So: reused → `reused`. Otherwise identity present in previous → `unchanged`
(recomputed to the same answer); identity absent → `added`.

The brief's worked example holds: reusing `ui-ir:v1` and producing `code:v2`
against a previous `[ui-ir:v1, code:v1]` gives `added: 1, reused: 1,
removed: 0, unchanged: 0`.

### 6. Only incremental runs are reconciled

The engine reconciles when **both** a reconciler and an incremental planner are
configured. A full execution has nothing to reconcile against: every artifact
was produced by this run, there is no previous set, and the merge is an
identity function over `candidateArtifacts`.

Running it anyway would add a failure mode to the hot path of every ordinary
execution in exchange for no information. When reconciliation does not apply
the candidate set is returned unchanged, so an unplanned run reaches `apply`
exactly as it did before this stage.

Reconciliation runs **before** `apply`, so the committed set and the completion
checkpoint both reflect the reconciled result rather than the raw candidates.

### 7. Splitting reused from produced

`ExecuteResult` gained `reusedArtifacts` and `producedArtifacts` alongside
`candidateArtifacts`, and `LayerNodeResult` gained an optional `reused` flag
set on the reuse path. Every existing consumer still reads `candidateArtifacts`
and is unaffected; only reconciliation needs the two apart.

## Consequences

- `packages/sdk/src/execution-reconciliation.ts` is new. `artifactRefSchema`
  gained an optional `version`; `ExecutionEventType` gained
  `execution.reconciled`. All additive.
- `packages/core/src/reconciliation/` is new: `comparison.ts` (identity,
  version resolution, conflict rules) and `reconciler.ts`.
- Core gained `ArtifactReconciliationError`.
- `ExecutionEngineConfig` and `ExecutionServiceConfig` gained an optional
  `executionReconciler`.
- An incremental run's reported artifacts now carry `version`; a full run's do
  not. Consumers must treat it as optional.
- A reconciliation conflict **fails the execution**. A run that previously
  completed with an incoherent artifact set now fails loudly. That is the
  intent, but it is a new failure mode for hosts already running incrementally.

## Migration Notes

### Nothing is required

Every existing configuration behaves as before. Reconciliation is opt-in and
inert without an incremental planner.

### To complete the incremental loop

```ts
import {
  ArtifactSetReconciler,
  ExecutionService,
  IncrementalExecutionPlannerService,
  RegistryArtifactMaterializer,
} from "@designflow/core";

const service = new ExecutionService({
  ...config,
  artifactStore,
  incrementalPlanner: new IncrementalExecutionPlannerService({ ... }),
  reuseResolver,
  artifactMaterializer: new RegistryArtifactMaterializer({ registry: artifactStore }),
  executionReconciler: new ArtifactSetReconciler({ registry: artifactStore }),
});
```

`ArtifactSetReconciler` requires a registry: version-aware identity is the
whole point, and a reconciler that cannot resolve versions cannot do its job.

### Behaviour changes when a reconciler is added

- **A conflicting artifact set now fails the run.** Previously a duplicate or
  ambiguous set completed and downstream consumers saw whichever entry came
  first. Verify a resolver does not adopt an artifact a node also produces.
- **Reported artifacts carry `version`.** Read it as optional; a full execution
  still reports unversioned references.
- **Removals are reported.** An id in the previous run's `appliedArtifacts`
  that this run neither reuses nor produces appears in `removedArtifactIds`,
  and is dropped from the final set.

### For implementers of `ExecutionReconciler`

- Be read-only. The engine calls `reconcile` once per run and assumes no side
  effects.
- Return the final set from `reconcile`; the engine applies and checkpoints
  exactly what you return.
- Stamp versions on returned references, or the next run cannot compare
  identities against them.
- Report conflicts by throwing a `DesignFlowError`. The engine treats a
  reconciliation failure as an execution failure.
