# MVP Application

**Date:** 2026-07-28
**Status:** Accepted
**Stage:** 31

## Context

Stage 30's demo proved the product APIs are sufficient for a real consumer, but
it was still a developer artefact: a CLI, in-memory, gone the moment the
process exited. A person outside the team could not open it, and a run they
started could not be found again.

Stage 31 makes DesignFlow something a person can use: a browser, a durable
store, and a run that is still there tomorrow.

## 1. MVP Architecture

Three new tiers, each with one job:

```
@designflow/core   ── engine
        │
        ▼
@designflow/product   WorkflowRunner
        │
        ▼
apps/designflow-api   ← composition root. Wires SQLite + engine + product.
        │             The ONLY tier naming a concrete implementation.
        │  HTTP
        ▼
apps/designflow-web   React. Imports @designflow/product for types and
                      schemas; no engine package, ever.

packages/storage-sqlite   Adapters for contracts that already existed.
                          Depends on @designflow/sdk alone.
```

The web client cannot reach the engine even if someone tries: it runs in a
browser, and the only thing it can call is HTTP. That physical separation is
what makes the rule enforceable rather than aspirational — and a test scans the
sources anyway, so a stray import fails CI before it fails in review.

## 2. Application Flow

```
Home            GET  /api/workflows              → pick a workflow
Input           (client-side)                    → describe the work
Start           POST /api/workflows/:id/start    → returns an ExecutionHandle
Running         GET  /api/executions/:id/progress → the checklist
Approval        POST /api/executions/:id/approve → or /reject
Result          GET  /api/executions/:id/explain → counts, artifacts, timeline
History         GET  /api/executions/history     → previous runs
```

`App.tsx` holds which screen is visible and the last data fetched. It models no
execution state of its own: `status.state` from the runner decides what the
user sees, so the UI cannot disagree with the engine about whether a run is
waiting, finished or failed.

## 3. Persistence Decisions

**SQLite via `bun:sqlite`.** Already in the runtime, so durability cost no new
dependency, and the database is a single file a reader can delete to start
over. Supabase or Postgres would have added an account, a network hop and a
migration story for an MVP whose requirement is "the run is still there after a
restart".

**Adapters, not a redesign.** Four classes implementing contracts that already
existed:

| Adapter | Contract |
|---|---|
| `SqliteExecutionRepository` | `ExecutionRepository` |
| `SqliteApprovalManager` | `ApprovalManager` |
| `SqliteArtifactStore` | `RegistryArtifactStore` |
| `SqliteExecutionEventStore` | the product layer's `ExecutionEventSource` |

Nothing about how executions or artifacts *work* changed. Every read re-parses
through the SDK schema, so a hand-edited or migrated database cannot feed the
engine a shape it does not expect.

**The event store is not optional.** The engine's own
`ExecutionEventRepositorySubscriber` persists only events that map to a
lifecycle phase, which drops every `artifact.*` event plus planning and
reconciliation. Those are exactly the events that explain what a run reused and
changed, so without this table a restarted process could show a run's status
but not its story. A test asserts the *narration* survives, not just the
record — that is the assertion that would have caught the omission.

**The event publisher stays in memory.** It is a dispatcher, not a store; what
it dispatches is what the event store persists.

**The approval table is why persistence matters most.** A person may answer an
approval hours later, from a different session. Only `pending` may transition,
so a double-clicked button cannot flip a rejection into an approval.

## 4. API Design

Thin by construction. Every route parses a request, calls **one**
`WorkflowRunner` method, and serialises the result. No route reaches past the
product layer, computes a status, or counts an artifact — if a number appears
in a response, the runner produced it.

Implemented as a plain `Request => Response` function rather than against a
framework, so the whole surface is testable by calling `handle(request)` with
no server listening. `Bun.serve` puts it on a port in three lines.

Domain error codes map onto HTTP statuses (`ERR_EXECUTION_NOT_FOUND` → 404,
`ERR_NO_PENDING_APPROVAL` → 409), and the code travels in the body so a client
can branch on it rather than on prose.

**Responses are validated on the client with the product layer's own schemas.**
A server change that breaks the contract fails loudly at the boundary instead
of rendering `undefined` three components deep. That is why `api-client.ts`
parses rather than casts.

## 5. Files Created

```
packages/storage-sqlite/          @designflow/storage-sqlite (sdk only)
  src/schema.ts                   tables + JSON helpers
  src/execution-repository.ts     ExecutionRepository
  src/approval-manager.ts         ApprovalManager
  src/event-store.ts              raw event stream
  src/artifact-store.ts           RegistryArtifactStore
  src/storage.test.ts             25 tests

apps/designflow-api/              @designflow/api
  src/host.ts                     composition root
  src/router.ts                   the HTTP surface
  src/main.ts                     Bun.serve entry
  src/api.test.ts                 23 tests

apps/designflow-web/              @designflow/web (React + Vite)
  src/api-client.ts               schema-validated client
  src/App.tsx                     shell + screen state
  src/screens/                    InputForm, RunningView, ApprovalView,
                                  ResultView, HistoryView
  src/architecture.test.ts        3 boundary tests
```

## 6. Tests Added

51 across three packages, covering every point the brief listed:

| Requirement | Where |
|---|---|
| Start a workflow through the API | `api.test.ts` — "starting a workflow" |
| Persists after restart | `api.test.ts` — three tests closing the host and reopening the file |
| Progress returned correctly | `api.test.ts` — "progress" |
| Approval flow through the API | `api.test.ts` — including "an approval survives a restart" |
| Completed execution returns artifacts | `api.test.ts` — "results" |
| History returns previous executions | `api.test.ts` — including "history survives a restart" |
| Web app does not import core | `architecture.test.ts` |

Beyond the list, `storage.test.ts` proves each adapter honours its contract and
recovers from disk, including lineage and cycle rules.

The MVP was also exercised end to end by hand: server up, workflow started via
`curl`, approval granted, progress and history read back, process killed, a new
process started against the same database, and the run recovered.

## 7. Known Limitations

**A run finishes before `start` returns.** `ExecutionContract.execute`
allocates the execution id only on return, so the browser cannot watch a live
run — it fetches progress after the fact and offers a Refresh button. Genuinely
streaming progress needs the engine to allocate ids up front, which is an
engine change and out of scope. The demo CLI can show live frames only because
it shares a process with the engine.

**Input field descriptors live in the web app.** `WorkflowManifest` has no
field metadata, so `InputForm` carries a map from workflow id to fields. The
form is *generated* from that map rather than hardcoded per workflow, so a
second workflow adds an entry rather than a screen — but the descriptors belong
on the manifest, and that is the right next change.

**Payload blobs inflate artifact counts.** Each capability registers a
content-addressed payload beside its named output. The UI lists named artifacts
and reports the rest as "N stored payloads not listed", so totals still
reconcile. The underlying fix — letting a store mark an artifact internal —
remains open from Stage 29.

**A resumed execution is its own predecessor.** `ExecutionEngine.resume` sets
`previousExecutionId` to the resuming execution's own id, so a post-approval
resume with the planner enabled narrates "0 steps to run" before running
everything. Correctness holds only because the reuse resolver declines and the
engine falls back to executing. Unchanged here; it is an execution-semantics
question.

**The artifact graph logic is duplicated.** `SqliteArtifactStore` reimplements
relation validation, cycle scope and lineage traversal because
`@designflow/core` is off-limits to a package under the import matrix.
Extracting those helpers into the SDK is the right fix; the two test suites are
the guard meanwhile.

**Single process, single user.** No auth, no teams, no queue — all explicitly
out of scope. Two API processes against one SQLite file would race; WAL makes
that survivable but it is not a supported configuration.
