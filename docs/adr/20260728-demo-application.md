# DesignFlow Demo Application

**Date:** 2026-07-28
**Status:** Accepted
**Stage:** 30

## Context

Stages 27–29 built a product layer and a real vertical workflow, but the only
way to see any of it was to read tests. Nothing let a person start work, watch
it, answer an approval and read what came out.

Stage 30 is that: a demonstration application, and — more usefully — the first
proof that the product APIs are sufficient for a real consumer.

## 1. Application Architecture

```
@designflow/core   ← engine
        │
        ▼
@designflow/product   WorkflowRunner, ProductExecutionService
        │
        ▼
apps/designflow-demo
        │
   ┌────┴─────────────────────────┐
   │                              │
 host.ts                    app.ts + screens/
 composition root           the journey
 (the only core import)     (product types only)
        │                          │
        └──────────┬───────────────┘
                   ▼
                 io.ts
        DemoIO port: terminal, or a test script
```

Four modules, each with one job:

| Module | Responsibility |
|---|---|
| `host.ts` | Wires concrete engine implementations. **The only file importing core.** |
| `catalog.ts` | The workflows on offer, as data — drives both landing and input form |
| `screens/` | Pure `(product model) => string`. No IO, no clock, no engine |
| `app.ts` | The journey: choose → describe → watch → approve → understand |
| `io.ts` | The `DemoIO` port. `ScriptedIO` drives it in tests |
| `main.ts` | Terminal entry. The only place touching stdin/stdout |

**A CLI, not a web app.** The brief asked for the smallest reasonable
implementation. A CLI needs no bundler, no DOM test harness and no framework
dependency, and it sidesteps §2.6 of the constitution entirely (UI framework
libraries must be isolated in dedicated packages). Screens are pure string
functions, so a future web UI can reuse the whole view layer by swapping the
renderer for components — the journey and the models do not change.

## 2. Why the Demo Belongs Outside the Engine

Because it would otherwise become a second definition of what a run *is*.

Every number the demo shows — steps completed, artifacts created, artifacts
reused, the timeline, the narration — comes from `WorkflowRunner`. The demo
counts nothing, tracks nothing and remembers nothing. There is no second source
of truth to drift from, which is why the completion screen cannot disagree with
the engine about what happened.

That is a claim worth enforcing rather than asserting, so a test walks the
package's own sources and fails if any file except `host.ts` imports
`@designflow/core`.

**The composition root is the honest exception.** `WorkflowRunner` takes an
`ExecutionContract`, and the only thing satisfying it is `ExecutionService`.
Somebody has to construct concrete implementations; pretending otherwise would
mean pushing a factory into `@designflow/product`, which would make the product
layer depend on core and invert the boundary Stage 27 exists to draw. Confining
the wiring to one file keeps "the demo consumes DesignFlow" true of the
application rather than merely intended. `apps/cli` sets the same precedent and
§5.1 sanctions it for apps.

## 3. How Future Products Reuse These APIs

Everything above `host.ts` is portable:

- **A web UI** replaces `screens/` string renderers with components and `io.ts`
  with React state. `app.ts` and the product models are unchanged.
- **An HTTP API** maps routes onto `WorkflowRunner` methods one-for-one:
  `POST /runs` → `start`, `GET /runs/:id` → `status`, `POST /runs/:id/approve`
  → `approve`, `GET /runs/:id/explain` → `explain`.
- **A second vertical workflow** is an entry in `catalog.ts` plus a
  `workflowPackage.load()` in the host. No screen changes: the input form is
  generated from the catalogue's field descriptors.

The demo is therefore a template as much as a demonstration.

## 4. Files Created

```
apps/designflow-demo/
  package.json          bin: wf-demo; depends on product, sdk, the workflow, core
  tsconfig.json
  src/host.ts           composition root — the only core import
  src/catalog.ts        workflow descriptors driving landing + input form
  src/io.ts             DemoIO port + ScriptedIO
  src/screens/index.ts  8 pure renderers
  src/app.ts            the journey
  src/main.ts           terminal entry (interactive + piped)
  src/index.ts          barrel
  src/app.test.ts       30 tests
```

## 5. Tests Added

30 behaviour tests, driving the journey through `ScriptedIO` and asserting on
what a person would see: workflow selection (5), starting (4), progress (4),
approval (5), completion (5), explanation (3), artifact visualization (2),
architecture (2).

The architecture test is the load-bearing one — it walks the source tree and
fails if anything but `host.ts` reaches for the engine.

## 6. Example User Journey

```
$ wf-demo

DesignFlow
Turn ideas into production workflows.

Choose a workflow:
  1. Design → Code
     Turn a design file into reviewed, production-ready components
Start which workflow? [Design → Code]: 1

Design → Code
──────────────────────────────────────────────
Tell DesignFlow what to work on.

Design file (homepage.fig): homepage.fig
Framework (react) [react / vue / svelte]: react
Frames (comma separated) (...): brand/Header, brand/Footer, layout/Dashboard

Approval Required
──────────────────────────────────────────────
DesignFlow wants to:
  Generate production code files
Reason:
  Approval required by policy rule "approve-code-generation"
Approve? [approve / reject]: approve

Design → Code
──────────────────────────────────────────────
Running
  ✓ Analyze design
  ✓ Extract design tokens
  → Create component structure
  ○ Generate code
  ○ Validate output
  2 of 5 steps

Workflow Complete
──────────────────────────────────────────────
Design → Code finished — created 5 artifacts.

Artifacts
  Created: 5
  Reused:  0

Timeline
  09:14  Started workflow
  09:14  Planning workflow
  09:14  Completed successfully

Produced
  Design analysis  (created)
     by analyze-design
  Design tokens  (created)
     by extract-design-tokens
     from Design analysis
  …
  (5 stored payloads not listed)

What DesignFlow did
──────────────────────────────────────────────
  Started workflow
  Planning workflow
  Running workflow steps
  …
  Completed successfully
```

## Decisions

### Progress is genuinely live

`WorkflowRunner.start` settles only when the engine settles, so a single frame
after the fact would be the easy implementation. But events are published
*during* that await, so `host.onProgress` subscribes before the call and the
checklist redraws as each step lands. Frames are deduplicated, so a redraw only
happens when the rendered text actually changes.

### Payload blobs are counted, not listed

Stage 29's two-identity design means each capability registers a
content-addressed payload alongside its named output — ten registrations for
five outputs. Listing `4c36f6ae451c…` beside "Design tokens" made the summary
unreadable.

The completion screen lists artifacts that carry a name and reports the rest as
`(5 stored payloads not listed)`. Hiding them silently would be worse: the
total still has to reconcile with the engine's own count, and a reader who adds
up the list should not come up short.

This is a **presentation** fix in the demo, not a platform change. The
underlying wrinkle — that payload blobs are indistinguishable from outputs at
the registry level — remains open, and the right fix is letting a store mark an
artifact as internal.

### Piped stdin is supported explicitly

`readline/promises` stalls after its first read when stdin is not a TTY, so the
first version of `main.ts` hung after one answer under
`printf … | wf-demo`. The entry point now drains piped input up front and
serves it from a queue, keeping `readline` for real terminals. A demo that
cannot be scripted is a demo most people will never successfully run.

## Consequences

- `apps/designflow-demo` is new. Nothing else in the repo changed — no engine
  file, no product file, no workflow file.
- The demo depends on core in `package.json` because its composition root must.
  §5.1 already permits this for apps.
- The event collector and artifact store are in-memory, so each `wf-demo`
  invocation starts empty. Incremental reuse is wired and works within a
  process, but a fresh run has nothing to reuse — the reuse story is
  demonstrated by `workflow-design-to-code`'s tests, not by a single CLI run.

## Observation for a future stage

Running the demo surfaced an engine interaction worth recording, **not fixed
here** because it would mean changing execution semantics.

`ExecutionEngine.resume` sets `previousExecutionId` to the resuming execution's
*own* id. When a run resumes after an approval with the incremental planner
enabled, the planner therefore sees "a previous execution exists, and nothing
changed" and plans zero steps — narrating "Analyzed dependencies — 0 steps to
run, 5 up to date" immediately before running all five.

Correctness is preserved only because the reuse resolver declines (there are no
prior artifacts to adopt on a first run) and the engine falls back to executing
the node. That fallback is doing real work here. The narration is misleading,
and the underlying question — whether a resumed execution should count as its
own predecessor — belongs to whoever revisits the planner.
