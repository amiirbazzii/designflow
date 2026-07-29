# Worker Catalogue

**Date:** 2026-07-30
**Status:** Accepted
**Stage:** 33

## Context

The CLI shipped speaking the engine's vocabulary: `designflow list` showed
`Design → Code (design-to-code)` and `designflow run design-to-code` ran a
pipeline. That is what the system *is*, not what a person wants.

Someone hiring help thinks "I need a design engineer", not "I need to invoke a
design-to-code pipeline". Stage 33 introduces the layer that lets them say so.

## 1. Worker Architecture

```
User
  ↓  designflow run design-engineer
Worker          ← metadata: identity, description, category, input fields
  ↓  primaryWorkflowOf()
Workflow        ← the pipeline that does the work
  ↓
Capabilities
  ↓
Artifacts
```

A worker is **metadata and composition, and nothing else**. It has no
behaviour, no execution logic and no engine import. Resolution is a map lookup
from worker id to workflow id; from that point on, the run is exactly the run
it always was.

The test of whether this stayed a naming layer: **delete `packages/workers` and
every workflow still works identically.** Nothing in the engine, the product
layer or the workflow packages learned that workers exist.

Two pieces:

| Where | What |
|---|---|
| `packages/sdk/src/worker-manifest.ts` | `workerManifestSchema`, `WorkerRegistry`, `primaryWorkflowOf` |
| `packages/workers` | `InMemoryWorkerRegistry` + the built-in catalogue |

The schema sits beside `workflowManifestSchema` because it is the same kind of
thing one level up: a public contract describing installable metadata. The
registry is its own package because a catalogue is neither engine nor product
read-model — and because it depends on `@designflow/sdk` alone, which a test
enforces.

### Why not a package per worker

The brief sketched `workers/design-engineer/manifest.ts`. `registerWorker()`
already provides the seam a third-party worker needs: publish a package
exporting a `WorkerManifest`, and a host registers it — the catalogue changes
not at all. Packaging each of one worker separately would be structure without
a use, and can be added the day something actually ships on its own.

`createWorkerRegistry()` returns a **fresh** registry rather than a shared
singleton, so a host that registers its own workers cannot leak them into
another. That matters most in tests, where a leaked registration is a confusing
failure two files away.

## 2. Worker and Workflow

| | Worker | Workflow |
|---|---|---|
| Answers | "who can do this?" | "how is it done?" |
| Contains | metadata | nodes, capabilities, artifacts |
| Lifetime | catalogue entry | executed |
| Named by | `design-engineer` | `design-to-code` |
| Cardinality | wraps one or more workflows | wrapped by zero or one worker |

**A worker may name several workflows**; the first is the entry point.
`primaryWorkflowOf` is where a routing rule will go when multi-workflow workers
need one, and callers will not change when it does.

**A workflow needs no worker.** `test-workflow` has none, and stays runnable —
see below.

**Input fields moved onto the worker.** They were previously a table inside
`run.ts` keyed by workflow id. Now they travel with the manifest, so adding a
worker adds no code to the CLI. That also retires one of the three copies of
those descriptors flagged in Stages 30–32.

## 3. CLI Integration

`designflow list` shows workers grouped by category, and **never prints a
workflow id** — a test asserts the absence, because that is the whole point:

```
Available AI Workers
──────────────────────────────────────────────

  development

    Design Engineer
      Transforms designs into production-ready applications
      designflow run design-engineer
```

The interactive menu now reads "Hire a worker".

`designflow run <name>` resolves a worker first, then **falls back to a
workflow id**. Workflow ids are no longer *exposed*, but accepting them keeps a
workflow with no worker reachable, and gives power users an escape hatch.
Running one prints a nudge toward the proper name:

```
(design-to-code is a workflow — its worker is design-engineer)
```

Execution is unchanged: `runCommand` calls `context.runner.start(...)`. A test
enumerates every `context.runner.*` call in `commands/` and fails on anything
outside `WorkflowRunner`'s public surface, or on any mention of an engine
service or store.

## 4. Files Created

```
packages/sdk/src/worker-manifest.ts        schema, registry contract, resolver
packages/workers/
  package.json  tsconfig.json
  src/registry.ts                          InMemoryWorkerRegistry
  src/catalog/design-engineer.ts           the built-in worker
  src/index.ts                             createWorkerRegistry, BUILT_IN_WORKERS
  src/registry.test.ts                     21 tests
```

Modified: `packages/sdk/src/index.ts`; the CLI's `cli-runner.ts`, `list.ts`,
`run.ts`, `interactive.ts`, `cli.ts`, `ui/terminal.ts`; `scripts/cli-smoke-test.sh`.

## 5. Tests Added

**33 new** (21 in `packages/workers`, 12 in the CLI), plus 7 existing CLI tests
rewritten from workflow to worker vocabulary. Total: **881 passing, 0 failing**.

| Requirement | Coverage |
|---|---|
| Manifest validation | 6 — required fields, empty workflow list refused, input descriptors, shipped manifest |
| Registry lists workers | 5 — built-ins, order, grouping, per-host isolation |
| Registry resolves a worker | 5 — by id, unknown, error names what was available, worker→workflow, workflow→worker |
| CLI lists workers not workflows | 4 — including one asserting no workflow id leaks |
| Running a worker runs the right workflow | 4 — history records the workflow, manifest supplies the fields |
| CLI does not bypass WorkflowRunner | 2 — enumerates every runner call, forbids engine services |

The smoke test now asserts both directions: `list` shows "Design Engineer" and
**fails if it leaks `design-to-code`**. `npm pack` → `npm install -g` →
`designflow run design-engineer` passes end to end under Node.

## 6. Known Limitations

**One worker.** The catalogue has a single entry, so grouping-by-category and
the multi-worker picker are exercised by tests rather than by real use.

**Multi-workflow workers have no routing rule.** `workflows[0]` is the entry
point by convention. A worker listing several today would silently only ever
run the first. `primaryWorkflowOf` is the one function that changes when that
becomes real.

**A worker cannot compose workflows.** It names them; it cannot say "run A then
B" or "run B if A produced X". That is workflow composition, which the engine
already supports via `kind: "workflow"` nodes — the right answer is a workflow
that composes, wrapped by one worker, not orchestration in the catalogue.

**Only the CLI speaks worker.** The demo app, the web client and the API still
present workflows. They work unchanged, but the vocabulary is now inconsistent
across surfaces, and the web app in particular still carries its own copy of
the input field descriptors.

**Category is a free string.** Deliberate, so a third-party worker can
categorise itself — but nothing normalises `development` against
`Development`, so two spellings would produce two headings.

**No agent runtime.** Explicitly out of scope: no memory, no tools, no
multi-agent anything. A worker is currently a name in front of a pipeline.
Making it feel like a worker *behaving* is a later stage; this one only fixed
what the user is asked to say.
