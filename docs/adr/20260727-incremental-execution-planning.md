# Incremental Execution Planning

**Date:** 2026-07-27
**Status:** Accepted
**Stage:** 24

## Context

Stage 23 gave the artifact graph the ability to say what a change invalidates,
and gave the engine a per-capability reuse boundary. Neither answers the
question a rerun actually asks: *given these artifacts changed, which nodes of
this workflow still need to run?*

Today every run executes every node. The reuse boundary can decline individual
capabilities, but it is consulted node-by-node during execution, with no view
of the workflow as a whole — it cannot say "these three nodes are downstream of
the change, the other one is not".

## Decision

### 1. The planner is analysis, and only analysis

`IncrementalExecutionPlanner` (SDK) has three methods and no side effects. The
core implementation resolves a workflow definition, classifies its nodes, and
returns the classification. It never executes anything, never touches an
artifact, holds no cache, and does not decide what may stand in for a skipped
node's output.

That last boundary is the important one, and it is what keeps this stage from
colliding with Stage 23:

| Concern | Owner |
|---|---|
| *Which* nodes need to run | Stage 24 planner |
| *What artifacts* stand in for a node that does not run | Stage 23 `CapabilityReuseResolver` |

They compose: a host that wires both gets node-level skipping plus artifact
adoption. A host that wires only the planner gets a run that skips nodes and
simply does not have their artifacts — which is why `reusableNodes` is a
*classification*, not a promise.

### 2. Nodes declare what they produce

Impact analysis needs to know which node produces a changed artifact. Nothing
in the workflow schema carried that, so `produces?: string[]` was added to
`capabilityNodeSchema` and `workflowNodeSchema`.

It is `.optional()`, **not** `.default([])`. A defaulted field is *required* in
Zod's inferred output type, which would have made `produces` a mandatory
property of every existing typed `WorkflowDefinition` literal — this broke
`workflows/workflow-test` immediately when first written that way. Optional
keeps every existing workflow compiling and parsing unchanged.

A node that declares nothing is never *directly* invalidated, but is still
invalidated through its dependencies. So an undeclared workflow degrades to
"nothing is directly hit", and — combined with the rules below — to a full
execution. Safe by default.

Deriving `produces` from artifact provenance instead was rejected: provenance
records `capabilityId`, not `nodeId`, and two nodes may run the same
capability, so the mapping is ambiguous. A future stage that puts `nodeId` into
provenance could derive this and make the declaration optional-in-practice as
well as in-schema.

### 3. The graph uses `dependsOn`, and only `dependsOn`

`buildWorkflowGraph` reads dependencies from `execution.dependsOn` — the exact
edge set `DagResolver` schedules on. `next` is deliberately ignored: it plays
no part in scheduling, and reading it here would let the planner disagree with
the executor about what runs after what.

Dependencies naming a node that does not exist are dropped, matching the
resolver, which ignores them rather than failing.

Duplicate node ids are rejected with `ERR_EXECUTION_PLANNING`. The resolver
silently lets the last one win; a plan referring to "parse" when two nodes
claim that id is meaningless. This is the one case where enabling the planner
can reject a workflow that previously ran — see migration notes.

### 4. Impact propagates forward, transitively

A node is affected when it produces a changed artifact (`artifact_changed`), or
when any node it depends on is affected (`dependency_changed`). Propagation is
a breadth-first forward closure from the directly-hit nodes, guarded by a
`seen` set, so a diamond does not re-walk its tail and a malformed cyclic graph
cannot spin.

A node hit both ways reports `artifact_changed`: the direct cause is the more
actionable one to show a user.

Impacts come back in workflow declaration order, so a plan is stable across
runs and diffable.

### 5. Reusable requires something to reuse

```
reusableNodes  = unaffected nodes, but only if a previous execution exists
skippedNodes   = reusableNodes
executionNodes = every other node
affectedNodes  = nodes the change set invalidated
```

`executionNodes` and `skippedNodes` **partition** the workflow: every node is
in exactly one. `affectedNodes` explains *why* a node is in `executionNodes` —
it may be there because it is affected, or because there was nothing to reuse.

The `previousExecutionId` condition is what makes a cold start correct. Without
a prior run, nothing is reusable, so the plan degrades to a full execution
rather than skipping work that was never done. Two consequences worth stating:

- **Empty change set + previous execution** → skip everything. Nothing changed,
  so nothing needs redoing.
- **Empty change set + no previous execution** → run everything. That is a cold
  start, not a no-op.

When an `ExecutionRepository` is configured the planner confirms the id names a
real record; without one it takes the id on trust. Both are conservative in the
direction that stays correct.

### 6. Engine integration is opt-in and inert by default

`ExecutionEngine` takes an optional planner as its **eighth** constructor
argument. With none configured, `resolvePlannedSkips` returns an empty set and
behaviour is byte-for-byte what it was before this stage — no planning call, no
event, no skipping.

The change set travels in execution metadata under the reserved
`changedArtifacts` key (`readChangedArtifacts` / `withChangedArtifacts`),
following the pattern Stage 21 established for lineage and input, so it is
persisted with the record and survives a resume. An empty set removes the key,
so a stale change set is never inherited. `previousExecutionId` is read from
the same metadata bag, where `ExecutionEngine.resume` already writes it.

A planner-skipped node is **not** a failure and does **not** block its
dependents — it is tracked separately from `failedSteps`, `pendingSteps` and
`blockedSteps`. Its dependents run normally, just without its artifacts.

### 7. The engine emits `execution.plan_created`, not the planner

Payload: `{ workflowId, affectedNodes, skippedNodes, executionNodes }`,
published before `execution.executing`.

The planner does not publish it. `ExecutionEvent.executionId` is required, and
the planner has no execution identity — `ExecutionPlanningRequest` carries a
workflow id and a *previous* execution id, neither of which identifies the run
being planned. Emitting from the engine keeps the planner free of execution
identity, which is what "the planner does not execute workflows" means in
practice.

## Consequences

- `packages/sdk/src/execution-plan.ts` is new. `capabilityNodeSchema` and
  `workflowNodeSchema` gained an optional `produces`; `ExecutionEventType`
  gained `execution.plan_created`. All additive.
- `packages/core/src/planning/` is new: `graph.ts`, `impact.ts`, `planner.ts`.
- Core gained `ExecutionPlanningError` (`ERR_EXECUTION_PLANNING`).
- `ExecutionEngine`'s constructor is now at **eight** positional parameters.
  This is well past where an options object belongs; the refactor is still
  deferred because it breaks every call site and is unrelated to this stage.
  It should be the next housekeeping change.
- A skipped node contributes no artifacts to the run. Pairing the planner with
  a `CapabilityReuseResolver` is what closes that gap.
- Impact analysis is a linear scan plus a BFS over the workflow graph, which is
  bounded by node count and adequate for any hand-authored workflow.

## Migration Notes

### Nothing is required

Every existing workflow, capability and engine call site works unchanged. The
planner is opt-in and inert when absent.

### To declare what a node produces

```ts
{ id: "transform", capabilityId: "cap-transform", produces: ["ui-ir"] }
```

Optional. A node without it is never directly invalidated by a change, only
through its dependencies.

### To enable incremental planning

```ts
import { ExecutionService, IncrementalExecutionPlannerService } from "@designflow/core";

const incrementalPlanner = new IncrementalExecutionPlannerService({
  resolveWorkflow: (id) => registry.get(id)?.definition,
  executionRepository,
});

const service = new ExecutionService({ ...config, incrementalPlanner });
```

Then supply the change set and the run to compare against, in metadata:

```ts
import { withChangedArtifacts } from "@designflow/sdk";

const metadata = {
  ...withChangedArtifacts(baseMetadata, ["ui-ir"]),
  previousExecutionId: "exec-previous",
};
```

Both are needed to skip anything. Omit `previousExecutionId` and the plan is a
full execution; omit the change set and — with a previous execution — the plan
skips everything.

**Pair it with a `CapabilityReuseResolver`** if downstream nodes need the
skipped nodes' artifacts. The planner decides what to leave out; only the reuse
resolver can supply what a left-out node would have produced.

### One behaviour change when the planner is enabled

A workflow with **duplicate node ids** is rejected with
`ERR_EXECUTION_PLANNING`. Such a workflow previously ran, with the last
duplicate silently winning. This only affects hosts that opt into planning, and
only workflows that were already ambiguous.

### For hosts rendering execution events

Handle `execution.plan_created`. `executionEventTypeSchema` is an enum, so an
unhandled member is a type error at the switch rather than a silent
fallthrough.
