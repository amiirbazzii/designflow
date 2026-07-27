# First User Workflow Experience

**Date:** 2026-07-28
**Status:** Accepted
**Stage:** 28

## Context

Stage 27 made an execution *legible* — an overview, a narration, a timeline and
artifact summaries. It is a read layer only. Starting work still means holding
an `ExecutionService`, and answering an approval still means knowing that an
approval id lives in `ExecutionRecord.metadata` and that
`resumeAfterApproval` must be called after `ApprovalManager.approve`.

So a consumer who wants to *interact* with DesignFlow still has to understand
engine plumbing. Stage 28 closes that: one object to start work, watch it,
approve it and look back at it.

## Architectural Review

### Where the functionality belongs

In `@designflow/product`, alongside Stage 27's read models — not a new package.
Stage 27 established the boundary; this stage adds the write-adjacent half of
the same surface. Splitting launch from status into separate packages would
make a consumer wire two things to do one job.

### Why it does not belong in core

Core's responsibility is orchestration: compile a DAG, schedule capabilities,
enforce the lifecycle. Everything added here is either **translation** (an
execution id to an approval id, a capability id to "Extract design tokens") or
**projection** (events to a progress checklist). Both are presentation
concerns, and both would have to change for reasons that have nothing to do
with execution correctness — a renamed label is not an engine change.

Critically, none of it is new capability. `WorkflowRunner.start` calls
`ExecutionContract.execute`. `approve` calls `ApprovalManager.approve` then
`ExecutionContract.resumeAfterApproval`. If the product package were deleted,
the engine would lose nothing.

The boundary holds mechanically: `@designflow/product` still depends on
`@designflow/sdk` **only**. `ExecutionContract` and `ApprovalManager` are SDK
interfaces, so the product layer can drive execution and approval without ever
importing core. That is what makes "do not move presentation into core"
enforceable rather than aspirational.

### How it reuses Stage 27

`WorkflowRunner` composes `ProductExecutionService` rather than reimplementing
it. `status` reads its overview; `history` maps `listOverviews`; `explain`
returns `getReport` unchanged. The one genuinely new projection is progress,
and it reads the same event stream Stage 27's narration reads — a second
projection of one stream, not a second state machine.

### How consumers will use it

```
              ExecutionContract        ApprovalManager        (SDK interfaces)
                     │                        │
                     └────────┬───────────────┘
                              ▼
                       WorkflowRunner            ← the only object a consumer holds
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         start/status     approve/reject    history/explain
              │
        UI / REST API / CLI
```

A REST API maps routes onto runner methods one-for-one. A CLI does the same. A
UI polls `status` for a progress bar and calls `approve` from a button. None
imports core; none constructs an `ExecutionContext`.

## Decision

### 1. `start` settles when the engine settles

`ExecutionContract.execute` allocates the execution id internally and returns
it only on completion. There is no earlier moment at which a handle could
exist, so `start` cannot return `{ state: "running" }` while work continues in
the background — there would be nothing to identify the run by.

`start` therefore awaits and reports the state that actually occurred. This
deviates from the brief's illustrative `state: "running"`, deliberately:
returning "running" for a run that has already finished would be a lie the
first `status` call contradicts.

Fire-and-forget launching needs the engine to allocate an execution id before
executing. That is an engine change, out of scope here, and worth doing on its
own terms rather than as a side effect of a presentation stage.

A **failed** run is reported through `handle.state`, not by throwing. A
workflow that ran and failed is an outcome to display; only a malformed request
throws.

### 2. Progress is a projection, and never claims a denominator it lacks

`buildProgress` reads the same events as narration. Step identity is the
capability id, which is what `capability.started` / `capability.completed`
carry, so two nodes running one capability appear as two steps — matching what
a reader sees.

`total` is resolved in descending order of authority:

1. `execution.plan_created` — the planner knows exactly what this run will do
   (`executionNodes + skippedNodes`)
2. an injected `resolveWorkflowStepCount`
3. the steps observed so far

Without 1 or 2, `total` grows as steps appear. A run with no known steps is
**0%**, not 100% — claiming completeness for an empty denominator would read as
"done" before anything happened.

A node whose work was reused emits no capability events but counts as done:
`artifact.reused` carries `capabilityId`, which is enough to place it.

Once an execution reaches a terminal event, no step remains `active`, whatever
the last capability event was — a crashed run should not display a spinner
forever.

### 3. Approvals translate, they do not decide

A person holds an execution id; `ApprovalManager` wants an approval id.
`ApprovalService` bridges the two — reading the id from the execution record's
metadata (written by the engine, survives restart), falling back to the
`execution.waiting_approval` event.

It then does exactly what the engine expects and nothing more: record the
decision via `ApprovalManager`, then call
`ExecutionContract.resumeAfterApproval`. No approval state, no policy, no
resumption logic lives here. Deciding an approval that is not pending raises
`ERR_NO_PENDING_APPROVAL` before anything is delegated, so a stray click cannot
resume a finished run.

### 4. `humanizeCapabilityId` stays mechanical

`cap-extract-design-tokens` becomes "Extract design tokens". No attempt is made
to conjugate it into "Extracting…". Guessing grammar from an identifier
produces worse text than leaving it plain, and tense belongs to whatever
renders it — the model exposes `status: "done" | "active" | "pending"` and lets
the renderer choose ✓ or →.

### 5. The runner is a facade, not a god object

`ApprovalService` and `buildProgress` are exported independently and usable on
their own. `WorkflowRunner` composes them so the common case needs one object,
without forcing that shape on a consumer who wants a part.

## Consequences

- `packages/product/` gained `runner.ts`, `progress.ts`, `approvals.ts` and
  schemas. No other package changed at all — this stage touches zero files
  outside `@designflow/product` and the ADR.
- `@designflow/product` remains SDK-only; the engine boundary is intact.
- `WorkflowRunner` needs an `ExecutionContract`. The obvious implementation is
  core's `ExecutionService`, which the composition root wires — the product
  package still does not know that type exists.
- `approvalManager` is optional. Without it, `pendingApproval` returns null and
  `approve`/`reject` throw, so a host with no approval gates wires nothing.
- Progress labels are derived from capability ids. A workflow whose capability
  ids are opaque (`cap-a`) gets an unhelpful checklist; the fix is better ids,
  or a future label map on the capability manifest.

## Migration Notes

### Nothing is required

Purely additive. Stage 27's `ProductExecutionService` is unchanged and remains
usable directly.

### To give users a workflow experience

```ts
import {
  InMemoryExecutionEventCollector,
  WorkflowRunner,
} from "@designflow/product";

const collector = new InMemoryExecutionEventCollector();
collector.subscribeTo(eventPublisher);      // before anything runs

const runner = new WorkflowRunner({
  executionContract: executionService,      // core's ExecutionService
  executionRepository,
  eventSource: collector,
  artifactRegistry: artifactStore,
  approvalManager,
  resolveWorkflowName: (id) => registry.get(id)?.definition.name,
  resolveWorkflowStepCount: (id) => registry.get(id)?.definition.nodes.length,
});

const execution = await runner.start({
  workflowId: "design-to-code",
  input: { designFile: "homepage.fig" },
});

await runner.status(execution.executionId);
await runner.approve(execution.executionId, "looks right");
await runner.history("design-to-code");
await runner.explain(execution.executionId);
```

**Subscribe the collector before starting work.** It records what it hears;
events published earlier are unrecoverable, and status/progress for such a run
will be empty while the overview still resolves from the repository.

**Supply `resolveWorkflowStepCount`** if you want a stable progress denominator
from the first status call. Without it, `total` climbs as steps appear, which
makes a progress bar move backwards.

### For future UI, API and CLI work

Depend on `@designflow/product` alone. Reaching past it into `@designflow/core`
or into SDK internals re-creates the coupling this layer exists to remove, and
the product view will start disagreeing with the engine.
