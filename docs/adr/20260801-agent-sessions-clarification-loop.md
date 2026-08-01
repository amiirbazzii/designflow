# Agent Sessions and the Clarification Loop

**Date:** 2026-08-01
**Status:** Accepted
**Stage:** 39

## Context

Stage 35 made an agent decide once. Stage 37 recorded that it happened. Stage
38 let it decide with a model. Every stage kept `AgentRuntime.decide` a single
bounded call — one task in, one decision out — and that discipline is what
keeps a decision reviewable, budgeted and refusable. It also created a dead
end: when the one decision an agent could make was `request_clarification`,
the CLI printed the question and exited. There was nowhere for the answer to
go. Stage 39 gives it somewhere, without turning `decide` into a loop.

```
User request
  → WorkerTaskRouter (unchanged)
  → AgentSessionService.startSession
      → AgentRuntime decision 1 (via WorkerTaskRouter)
      → request_clarification → session persisted, waiting_for_user
      → [process may exit here]
  → AgentSessionService.answerSession (a later process, or the same one)
      → AgentRuntime decision 2 (via WorkerTaskRouter, same worker/agent)
      → run_workflow → WorkflowRunner.start → executionId recorded
      → session completed
```

## 1. Why sessions are product-level state, not engine state

`packages/core` has never known a worker or an agent exists — Stage 35
deliberately kept the engine ignorant of the layer above it, so that "what a
workflow does" and "what chose to run it" stay separable. A session is one
step further from execution than an agent decision already is: it is memory
about a *conversation*, not about a *run*. Teaching the engine about sessions
would mean teaching it about clarification, turn limits and expiration — none
of which change what a workflow node does when it runs.

Sessions live in `packages/product`, next to `WorkerTaskRouter` and
`WorkflowRunner`, and are stored in a sibling collection of the same
`FileStore` document traces and executions already share (`sessions:
Record<string, AgentSession>`). `packages/core` gained no new field, no new
concept and no new import.

## 2. Why each agent decision remains single-shot

`AgentRuntime.decide` still does exactly what Stage 35 defined: parse a task,
resolve an agent, build a decision-scoped context with its own tool and model
budgets, call `decide`, enforce the allow-list, return one `AgentDecision`. It
does not know a session called it. `WorkerTaskRouter.routeWorker` — the
existing Stage-35 boundary — is the *only* way `AgentSessionService` reaches
an agent, on both the first turn and every resumed one.

This is why tool and model call budgets reset per decision rather than per
session: `AgentScopedToolService`/`AgentScopedModelService` are constructed
fresh inside `AgentRuntime.decide` on every call, and `AgentSessionService`
never constructs one itself. A session that has been resumed four times has
made four decisions, each with its own full budget — the session turn limit
(§7) is a separate, external ceiling on how many times the session may ask,
not a redefinition of what one decision may spend.

## 3. Why the Session Orchestrator owns repetition

Something has to remember "I already asked this" and "here is what was
answered" across process boundaries — a CLI invocation is a new process every
time. That memory cannot live inside `AgentRuntime` without turning `decide`
into a loop the runtime itself controls, which is the one thing Stage 35's own
design note ruled out: *"An agent that could re-enter its own decision would be
scheduling work, and scheduling work is the engine's job."*

`AgentSessionService` is that "something else." It is a plain product-layer
class depending on ports (`SessionStore`, `WorkerRegistry`,
`WorkerTaskRouter`, `SessionWorkflowStarter`), not on any concrete
implementation. The CLI's `commands/session-flow.ts` owns the *interactive*
repetition — looping `terminal.ask` while a person is willing to answer — but
even that loop is just repeated calls to `answerSession`; it holds no session
state of its own.

## 4. Why sessions store clarification answers but traces do not

A trace answers "what happened, and did it work?" — Stage 37's whole argument
is that a trace has no field for what was asked or what was said, because a
trace is an audit record and audit records must be readable without carrying
the thing they are auditing.

A session answers a different question: "what has this conversation
established so far?" — and it cannot answer that without the question and the
answer, bounded (`SessionAnswer.question`/`.answer`, `.max(2_000)`/`.max(4_000)`)
and validated. The two records are correlated (`AgentSession.traceIds`,
one entry per decision) and never merged. `session.answered` /
`session.waiting_for_user` events carry a `turn` number and, where relevant, a
`traceId` — never the question or answer text — so the trace-adjacent
observability channel keeps Stage 37's guarantee even though the session
store next to it does not.

## 5. Why sessions are not unrestricted chat history

`SessionAnswerSchema` is not a role-based message list. There is no `role`
field, no way to append an arbitrary turn, and `agentSessionSchema.answers` is
validated on every write to have strictly increasing `turn` numbers
(`agentSessionSchema`'s `superRefine`). A session holds exactly one shape of
exchange — a clarifying question and the answer to it — because that is what
resuming a bounded decision requires, and nothing about Stage 39 is a general
memory or conversation feature. `SessionContextBuilder` (§9) enforces the same
restraint at read time: what reaches the agent is `{originalRequest,
inputSummary?, clarifications: [{question, answer}]}`, never a transcript.

## 6. State transition semantics

```
active → waiting_for_user → active → completed
active → declined
active → failed
waiting_for_user → cancelled
waiting_for_user → failed   (turn limit exceeded)
```

Encoded as data (`SESSION_TRANSITIONS` in `packages/sdk/src/session.ts`),
consulted by `isValidSessionTransition`/`isTerminalSessionStatus` rather than
inferred from which fields happen to be set. Every terminal status —
`completed`, `declined`, `failed`, `cancelled` — maps to an empty transition
list, so "can this session still move?" is one table lookup. `AgentSessionService`
never writes a status the table does not permit; a store-level `update` cannot
either, because `agentSessionSchema.parse` runs on every write and rejects
anything the schema — including the answers array's own turn-ordering
constraint — does not allow.

**Completed means "the agent selected and started the workflow," not "the
workflow finished."** This is a deliberate deviation from the stage brief's
stated preference for the reverse. `WorkflowRunner.start` already blocks until
the engine's execution contract settles to a terminal state *or* an approval
gate — for the common path (no approval, or approval resolved synchronously)
those coincide and the distinction is invisible. Where they diverge is a
gated workflow: `run.ts`'s own approve/reject exchange happens *after*
`finishSession` returns, entirely outside `AgentSessionService`. Making
"completed" track the workflow's true final state would mean the session
either polling engine state it has no business polling, or growing an eighth
status to represent "started, approval pending" — both of which pull engine
execution semantics into a layer that is supposed to remain unaware of them.
"Completed" here means what the session itself is authoritative for: a
validated decision was handed to `WorkflowRunner` exactly once. The
authoritative record of what the run then did is, as always, `designflow
history <id>` and `designflow traces`.

## 7. Turn-limit and expiration policy

`maxClarificationTurns` (default 5) is enforced entirely inside
`AgentSessionService.applyDecision`, never by the agent. Each
`request_clarification` increments `turnCount`; when the next turn would
exceed the configured limit, the session is written to `failed` (with a safe
`metadata.errorCode`, never exposed to the CLI beyond a generic message) and
`SessionTurnLimitExceededError` (`ERR_SESSION_TURN_LIMIT_EXCEEDED`) is thrown
*before* any workflow can start. There is no field on `AgentDecision` an agent
could set to raise or bypass this — the limit is not part of the vocabulary a
decision is expressed in.

`expiresAt` is computed once, at `startSession`, from an injected
`SessionClock` (`SYSTEM_CLOCK` by default; tests inject a scripted one).
`assertAnswerable` checks `session.expiresAt <= clock.now()` before any other
state check, so an expired session refuses to resume with `ERR_SESSION_EXPIRED`
even if its stored `status` still reads `waiting_for_user`. Nothing sweeps
expired sessions from storage in this stage — `designflow sessions` would
simply never resolve one past its `expiresAt`, per the brief's "may remain
stored but render as expired." Both limits are configurable via
`config.json`'s `settings.sessions` bag (`services/session-config.ts`), read
the same defensive, field-by-field way `settings.models` already is; there is
no schema migration required to add either default.

## 8. Concurrency and idempotency strategy

`SessionStore.update(sessionId, expectedVersion, patch)` is optimistic
concurrency, not a lock: every stored `AgentSession` carries a `version`,
bumped by exactly one on every successful update (`applySessionPatch`, shared
by `InMemorySessionStore` and `FileSessionStore` so the two cannot disagree
about the merge). A caller who read version *N* and tries to write against a
store already at version *N+1* gets `SessionConflictError`
(`ERR_SESSION_CONFLICT`) instead of a silent overwrite. `FileStore.mutate`'s
closure only calls `write()` after the mutator returns without throwing, so a
rejected update never reaches disk at all — the file is byte-identical to
before the attempt.

This is what makes "two concurrent answers produce at most one accepted
transition" true by construction rather than by an added lock: both readers
see version *N*; the first `store.update` to run wins and becomes *N+1*; the
second's expected version no longer matches and it fails. A completed session
therefore cannot start a second workflow — the second answer attempt fails at
the version check, long before `applyDecision` would ever call
`runner.start` again.

`AnswerSessionRequest.idempotencyKey` is a narrower, session-scoped
convenience on top of that: `AgentSessionService` keeps a per-process
`Map<string, Promise<SessionResult>>` keyed by `sessionId:idempotencyKey`, so
a duplicate submission with the same key returns the first attempt's promise
rather than racing a second transition through the store at all. It is
explicitly **not** a durable, cross-process idempotency ledger — a fresh CLI
process has a fresh cache — and the optimistic-concurrency guarantee above
is what actually holds across processes; the cache is a best-effort
convenience for the case that motivated it (an accidental double
`Enter`/retry within one interactive session), documented as such in code.

## 9. Bounded context construction

`SessionContextBuilder.buildSessionContext` (`packages/product/src/session-context.ts`)
is the only path from a stored `AgentSession` to what a resumed decision
receives. It returns `{originalRequest, inputSummary?, clarifications}` —
never the session object itself, never `traceIds`, `executionId`,
`modelProfileId`, `status`, timestamps or turn counters. `WorkerTaskRouter`'s
`WorkerTaskRequest.context` field (new, additive, `.optional()`) is what
carries `{clarifications, inputSummary?}` into `AgentTask.context` on a
resumed call — every caller before Stage 39 leaves it unset and is
unaffected.

Truncation is deterministic and documented in the function itself: clarification
pairs are walked newest-first against a character budget
(`maxClarificationChars`, default 4,000) and kept whole — a pair that does not
fully fit is dropped rather than cut mid-answer — then restored to
chronological order. The same session and the same options produce
byte-identical output on every call; there is no clock, no randomness and no
model call inside the builder itself.

## 10. Model-profile snapshot policy

**Chosen: preserve the original snapshot for the session's lifetime.**
`AgentSessionService.startSession` resolves `resolveModelProfileId(agentId)`
once, at creation, and stores the result as `AgentSession.modelProfileId` — a
reference, identical in kind to `AgentManifest.modelProfileId`, never a
provider id, model slug or credential. Every resumed turn uses the *same*
`agentId`, and therefore reaches the *same* `AgentManifest`, through the
unchanged `WorkerTaskRouter → AgentRuntime` path — `AgentRuntime` resolves the
live profile fresh on every call regardless, the same as it always has.

The snapshot on the session is not consulted to force the model call to use
an older configuration; it exists so that after the fact, `designflow
sessions <id>` and any auditing built on top of it can answer "which model
identity was this conversation started under?" even if the profile mapping
is edited mid-conversation. If a local `settings.models.profiles` override
changes what `design-engineer-default` resolves to between turn one and turn
two of the same session, turn two genuinely runs against the new
configuration — reproducibility here means "the same named profile," not "a
frozen configuration," matching how every other Stage-38 decision already
behaves. No credential is ever persisted; the field cannot hold one, the same
structural argument Stage 38 already made for `ModelProfile` itself.

## 11. Workflow execution correlation

When a resumed (or initial) decision is `run_workflow`, `applyDecision` calls
`SessionWorkflowStarter.start` exactly once, then writes `executionId` onto
the session in the same `persistUpdate` call that moves it to `completed` —
one atomic write, not two. If a `TraceService` was supplied, `traceId` is
correlated to that `executionId` immediately after, wrapped in its own
try/catch: a failed correlation degrades the trace record but never the run
or the session, the same discipline `run.ts` already applied for the
non-session path before Stage 39 and which now lives inside the service
instead of being duplicated at every call site.

`SessionWorkflowStarter` is a narrow port —
`{start(request): Promise<ExecutionHandle>}` — rather than the concrete
`WorkflowRunner`, so a test can supply a double that only records what it was
asked to run, without constructing an `ExecutionContract`. `WorkflowRunner`
satisfies it structurally, with no adapter.

## 12. Crash and partial-write behaviour

Every state transition is a single `SessionStore.update` call, and every
implementation of that call is atomic at the storage layer: `FileStore.write`
writes to `${path}.tmp` and `renameSync`s over the target, so a process killed
mid-write leaves the previous, fully-valid document — a crash between
`answerSession` recording the answer and the resumed decision returning
leaves the session `active` with the answer already durably recorded, which
is the correct place to resume from (a subsequent `getSession` reads exactly
that). There is no multi-step write anywhere in `AgentSessionService` where a
crash between step one and step two would leave a session and an execution
disagreeing — the executionId and the `completed` status land in the same
`update` call.

## 13. Future migration notes

Nothing here forecloses a richer conversation model, a web/API client, or
semantic memory — they were simply out of scope, per the stage's explicit
constraints. The seams intended to carry that weight without a rewrite:
`SessionStore` and `SessionObserver` are ports; a web/API client is another
consumer of `AgentSessionService`, not a reason to change it. `AgentSession`'s
`metadata` field is the same "nothing writes it today" open field `AgentTrace`
already carries, reserved rather than repurposed. Turning the fixed
question/answer shape into a richer exchange, or adding authentication,
multi-user sessions or a background expiry sweep, is new schema and new
service surface, deliberately not attempted here.

## 14. Files

**Created**

```
packages/sdk/src/session.ts                         AgentSession/SessionAnswer/*Request schemas, state machine, SessionStore port, SessionObserver/SessionEvent, applySessionPatch
packages/sdk/src/session.test.ts
packages/product/src/session-context.ts              SessionContextBuilder (buildSessionContext)
packages/product/src/session-context.test.ts
packages/product/src/session-store.ts                InMemorySessionStore
packages/product/src/session-service.ts              AgentSessionService, SessionWorkflowStarter, SessionClock
packages/product/src/session-service.test.ts
packages/product/src/session-errors.ts                ERR_SESSION_* error classes, SESSION_ERROR_CODES
apps/designflow-cli/src/commands/sessions.ts          `designflow sessions` / `answer` / `cancel`
apps/designflow-cli/src/commands/session-flow.ts      clarify()/finishSession()/watchProgress(), shared by run.ts and sessions.ts
apps/designflow-cli/src/session-commands.test.ts
apps/designflow-cli/src/services/session-config.ts    settings.sessions reader
docs/adr/20260801-agent-sessions-clarification-loop.md
```

**Modified**

- `packages/storage-file/src/store.ts` — `StoreDocument.sessions`, `emptyDocument()`.
- `packages/storage-file/src/adapters.ts` — `FileSessionStore`, `SessionAlreadyExistsError`/`SessionNotFoundError`/`SessionConflictError`.
- `packages/storage-file/src/storage.test.ts` — `FileSessionStore` coverage.
- `packages/storage-file/src/index.ts`, `packages/product/src/index.ts`, `packages/sdk/src/index.ts` — new exports.
- `packages/product/src/worker-task.ts` — additive `WorkerTaskRequest.context`, threaded into `AgentTask.context`.
- `apps/designflow-cli/src/services/cli-runner.ts` — wires `FileSessionStore` + `AgentSessionService` onto `CliContext.sessions`/`sessionConfig`.
- `apps/designflow-cli/src/commands/run.ts` — routes through `context.sessions` and the shared clarification loop instead of exiting on `request_clarification`.
- `apps/designflow-cli/src/cli.ts`, `src/main.ts` — `sessions`/`answer`/`cancel` dispatch; `answer` drains stdin like `run` does.
- `apps/designflow-cli/src/ui/errors.ts` — eleven `ERR_SESSION_*` mappings.
- `apps/designflow-cli/src/ui/terminal.ts` — `usage()` entries, `settings()` session-config display.
- `apps/designflow-cli/src/commands/settings.ts` — passes `sessionConfig` through.
- `apps/designflow-cli/src/model-mode.test.ts`, `src/cli.test.ts` — assertions updated for the new clarification UX (unchanged behaviour otherwise).

`packages/core`, every `workflows/*` package, and the engine's own persistence
schemas are unchanged.

## 15. Tests

**78 new tests**, across 5 files:

| Requirement | Coverage |
|---|---|
| Strict schemas, invalid statuses/answers rejected | `session.test.ts` (23 tests) |
| `FileSessionStore` persistence, atomic writes, restart, corruption, conflict | `storage.test.ts` (+11) |
| State machine, valid/invalid transitions, terminal-session resume refusal | `session.test.ts`, `session-service.test.ts` |
| Clarification loop: create → resume → same worker/agent, turn increments, one workflow start, decline, no execution on clarification | `session-service.test.ts` (22 tests) |
| Concurrency: two concurrent answers → one accepted, `ERR_SESSION_CONFLICT`, idempotency key dedup | `session-service.test.ts` |
| Turn limits externally enforced, independent of tool/model budgets | `session-service.test.ts` |
| Bounded context, deterministic truncation, no trace/session-object leakage | `session-context.test.ts` (7 tests) |
| Safe session events, no question/answer text in events, observer-failure isolation | `session-service.test.ts` |
| CLI: list/detail/`--status`, answer resumes, cancel, error-code mapping | `session-commands.test.ts` (15 tests) |
| Existing regression: deterministic + model-backed Design Engineer, per-agent model isolation, approval, artifact reuse, restart | full existing suite, all still green |

## 16. Defects found and fixed during implementation

- **`agentSessionPatchSchema.currentQuestion: null` failed re-validation.**
  Clearing a question on answer (`currentQuestion: null`) was merged directly
  into `{...existing, ...patch}` and re-parsed against `agentSessionSchema`,
  which has no `null` member for that field (only `.optional()`). Fixed by
  extracting the merge into a shared `applySessionPatch` (§ files) that treats
  a `null` patch value as "delete this field," used identically by
  `InMemorySessionStore` and `FileSessionStore` so the two could not diverge
  on the fix.
- **Progress checklist stopped rendering.** An early version of `run.ts`
  attached `context.onProgress` *after* calling `startSessionForWorker`, but
  `WorkflowRunner.start` — invoked inside the session service, on the very
  first call, for a worker that needs no clarification — had already
  completed by the time the listener was attached. Fixed by attaching the
  listener before the session starts, and confirmed by the existing "shows
  the checklist as steps land" regression test, which failed until this was
  corrected.
- **The deterministic strategy cannot be resumed by an answer.**
  `deterministicDesignEngineerStrategy`/`modelDesignEngineerStrategy`'s
  `hasSomethingToDo` guard reads only `task.request`/`task.input`, never
  `task.context`. Since `originalRequest`/`originalInput` are fixed at
  session creation, a worker that started with nothing to classify still has
  nothing to classify on turn two, however many times it is answered — the
  session mechanism itself resumes correctly (proven by a scripted
  model-provider test that returns different decisions per call), but no
  *built-in* deterministic worker can be driven end-to-end through a real
  clarification without a model. Documented as a known limitation (§17)
  rather than silently worked around, since fixing it is a change to the
  Stage-36 strategies' own prompt-building, out of scope here.

## 17. Remaining limitations

- **The deterministic strategy ignores resumed context**, as above — a
  clarification loop against `deterministicDesignEngineerStrategy` alone can
  extend a conversation but not resolve it. `modelDesignEngineerStrategy`
  does not have this problem structurally (it consults whatever the model
  returns, independent of the classifier), but nothing in this stage changed
  what either strategy *builds its decision from* — that remains Stage 36/38
  territory.
- **Idempotency keys are process-scoped**, not a durable ledger (§8). A
  duplicate answer across two different CLI processes is still safe — it
  fails with `ERR_SESSION_CONFLICT` rather than double-starting a workflow —
  but does not return the first attempt's result the way a same-process
  duplicate does.
- **No background expiry sweep**, by design for this stage. An expired
  session is refused on resume but stays in the store indefinitely; nothing
  removes it.
- **SQLite session storage was not built.** `SessionStore` is a port, and
  `@designflow/storage-sqlite` already has the `session`-shaped table pattern
  (`*_json` columns) to follow, but only `FileSessionStore` was implemented —
  matching the CLI's own storage choice and the stage's Node-compatibility
  constraint. A server tier adopting sessions would add
  `SqliteSessionStore` the same way `storage-sqlite` already differs from
  `storage-file` for every other record.
- **No packaged-tarball demonstration of a live clarification round-trip.**
  The packaged `dist/main.js` binary was smoke-tested for the regression path
  (a full `run design-engineer` completion), the new commands' error paths,
  and `designflow sessions`/`answer`/`cancel` wiring — but no worker in the
  built-in catalogue can be driven to ask a genuine clarifying question with
  real placeholder text (see the sixteen-line note above), so the
  clarification round-trip itself was verified through the automated test
  suite (which exercises the same `dispatch`/command code) and the
  `FileSessionStore` restart tests, rather than through a literal second
  `node dist/main.js` process against a hand-typed answer.

## 18. Readiness for Stage 40

The architecture holds the shape Stage 40 would need to extend: sessions are
product state behind ports, agent decisions stay single-shot and budgeted per
call, and nothing about the state machine, the context builder or the
concurrency strategy assumes a CLI process rather than a longer-lived server.
The main gap before a genuinely multi-turn *product* feature (as opposed to
a bounded clarification) would be worth building is the deterministic
strategy's blindness to resumed context, noted above — worth deciding
explicitly rather than working around before any stage builds directly on
top of it.
