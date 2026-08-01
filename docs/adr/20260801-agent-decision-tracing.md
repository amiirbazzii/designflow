# Agent Decision Observability and Tracing

**Date:** 2026-08-01
**Status:** Accepted
**Stage:** 37

## Context

Stage 35 made agents decide. Stage 36 gave them tools. Both stages ended with
the same note in "known limitations": nothing is persisted, so `why did it pick
that?` has no answer beyond re-running it and hoping.

That gap is tolerable while an agent is an if-statement. It stops being
tolerable the moment `decide` is a model call, because the answer becomes
non-deterministic and the question becomes urgent. Stage 37 answers it — and
answers it in the one way that does not create a much worse problem.

```
CLI / Product → AgentRuntime → TraceObserver → TraceStore → TraceService
```

## 1. Why traces are not logs

A log is prose. Whoever writes the line chooses what goes in it, so the only
way to know a log contains no secret is to read every line ever written — and
the only way to keep it that way is for every future contributor to keep
choosing correctly.

A trace is a fixed record with named fields and a strict schema. "Does this
contain the user's prompt?" is answered by looking at the *type*, not at the
data. There is no `message` field, so there is no line for anyone to write the
wrong thing into.

That is the entire design argument. Everything below follows from it.

| | Log | Trace |
|---|---|---|
| Shape | free text | fixed fields, strict schema |
| "Could it contain X?" | read all of it | read the type |
| Grows by | anyone adding a line | changing a schema, in review |
| Good at | narrative | counting, correlating, filtering |

## 2. Why traces contain no chain-of-thought

The tempting design is to store the prompt and the model's reply, because that
is genuinely the most useful debugging artefact. It is also:

- **the user's data**, often including whatever they pasted into a request
- **the highest-density secret store in the system** — API keys, file paths,
  customer names all arrive through the same channel
- **permanent** once written to `~/.designflow/history/runs.json`, a plain file
  with no retention policy, no encryption and no expiry

So the answer is no, and the no is structural. Every schema in
`packages/sdk/src/trace.ts` is `.strict()`, and none of them has a field for a
prompt, a request, a reasoning summary, a tool input or a tool output. A test
enumerates twelve such names and asserts each is refused.

The sharpest case is `ERR_AGENT_DECISION_INVALID` — the error raised when an
agent attaches private reasoning to its decision. The trace records **the code
and not the message**, because the message contains the reasoning that caused
it. Recording it would leak precisely the thing the decision schema refused.

What a trace *does* record is enough to be useful: who decided, when, how long,
what was decided, which tools were consulted and whether each worked. For "the
agent asked for clarification twice today and consulted no tools either time",
that is sufficient. For "what exactly did the model say", it is not, and that
is the trade being made deliberately.

## 3. Trace, Event, Execution History, Artifact History

Four records that all look like history and answer different questions:

| | Answers | Lifetime | Written by |
|---|---|---|---|
| **Trace** | "what did the AI decide, and why was it stopped?" | one decision | the agent runtime |
| **Trace event** | "what is happening right now?" | in flight | the runtime, to observers |
| **Execution history** | "what did this run do?" | one execution | the engine |
| **Artifact history** | "what does this output descend from?" | the artifact's life | the artifact registry |

The distinctions that matter:

**A trace can exist with no execution.** A clarification or a decline produces
no run at all — which is exactly why engine history cannot answer questions
about them. Those decisions are invisible to every record that existed before
this stage.

**An execution can exist with no trace.** A workflow started directly has no
decision to explain, and `getExecutionTrace` returns null rather than an empty
trace.

**Events are the transport; the trace is the record.** They are separate so a
consumer that only wants to watch does not have to poll a store, and a decision
does not need a store present in order to run.

## 4. Why tracing lives outside core

`packages/core` was not modified. It does not know agents exist, and after this
stage it still does not know traces do.

The engine's event stream is replayed and reconciled to reconstruct what a run
*produced*; every consumer assumes each entry belongs to an execution. A
decision that ended in `decline` belongs to no execution, so putting it there
would either break that assumption or require a synthetic execution to hang it
from.

Correlation therefore runs the other way: the **trace** holds an `executionId`,
not the reverse. `run.ts` records it after `runner.start` returns, because that
is the only point where both ids exist — the runtime decided before an
execution existed, and the engine never learns a decision was involved.

Storage reuses `FileStore` and adds one sibling collection. No engine record
gained a field; a test asserts `executions`, `events` and `artifacts` are
byte-identical to what they were, and that a document written before this stage
still loads. The gain is the atomic write: a run and the decision that started
it land in one rename, so they cannot disagree after a crash.

## 5. How evaluation systems can consume traces

The trace is already the right shape for the question an evaluation harness
asks — *how often, and how does it change?*

```ts
const traces = await service.listTraces({ agentId: "design-engineer-agent" });
const asked = traces.filter((t) => t.decisionType === "request_clarification");
const toolFailures = traces.flatMap((t) => t.toolCalls).filter((c) => c.status === "failure");
```

Clarification rate, decline rate, tool-failure rate by code, decision latency,
and how each moves when an agent's version changes — all answerable from stored
fields with no payload access. `agentId` carries the version's identity, so a
regression after an agent update is visible as a rate shift rather than as an
anecdote.

What this deliberately cannot support is example-level replay: "show me the
three requests it got wrong". That needs the requests, and storing them is the
thing this stage refuses. A future evaluation stage wanting that should
introduce a **separate, opt-in, consent-gated** store with its own retention
policy — not widen this one, whose value rests on being safe by construction.

## 6. How future LLM agents get debugged safely

When `decide` becomes a model call, the trace already answers most of the
operational questions without changing:

| Symptom | What the trace shows |
|---|---|
| "it stopped working" | `status: failed` with a code — invalid decision, forbidden workflow, budget |
| "it keeps asking me things" | `decisionType: request_clarification` rate |
| "it got slow" | `durationMs`, split by tool call |
| "a tool is broken" | `toolCalls[].status` and `errorCode` |
| "it did something it shouldn't" | `ERR_AGENT_WORKFLOW_NOT_ALLOWED`, with the run absent |

The last row is the important one. A prompt-injected model produces a *refused*
decision, and the refusal is now recorded with its code — Stage 36 emitted a
started event and then nothing, leaving the most security-relevant case as a
gap in the record.

For the cases the trace genuinely cannot answer, the intended path is a
debug-only, in-memory, never-persisted channel behind an explicit flag — not a
field on this schema.

## 7. Files

**Created**

```
packages/sdk/src/trace.ts                 AgentTrace, TraceEvent, TraceObserver,
                                          TraceStore, selectTraces, NOOP observer
packages/product/src/traces.ts            InMemoryTraceStore, TraceCollector, TraceService
apps/designflow-cli/src/commands/traces.ts
docs/adr/20260801-agent-decision-tracing.md
+ 3 test files
```

**Modified**

`sdk/agent.ts` (`traceId` on the result), `sdk/index.ts`,
`agents/runtime.ts` (trace lifecycle, failure event, injectable id and clock),
`agents/tool-service.ts` (`onCall` reporting), `product/worker-task.ts`
(`traceId` on the result), `product/index.ts`,
`storage-file/{store,adapters,index}.ts` (`FileTraceStore`, `traces`
collection), the CLI's `cli.ts`, `run.ts`, `cli-runner.ts`, `ui/terminal.ts`.

`packages/core`, `packages/artifacts`, `packages/state` and every workflow
package are **unmodified**.

## 8. Tests

**76 new** (20 SDK contracts, 20 product, 16 runtime, 8 storage, 12 CLI). Total:
**1252 passing, 0 failing** across 66 files, up from 1176.

| Requirement | Coverage |
|---|---|
| Trace and event schema validation | 14 — including twelve payload field names refused |
| Noop observer | 1 |
| Observer failure does not break execution | 4 — throws, rejects, and a refusal still propagates unchanged |
| Decision creates a trace | 3 — started event, ids correlated, result carries the id |
| Tool calls create trace events | 3 — order, failure code, calls before a failure survive |
| Completed and failed decisions close the trace | 5 — including clarification with no workflow |
| Trace correlates with the execution | 3 — both directions, and null for a run with no agent |
| Tracing does not alter execution | 2 — identical result with and without a tracer |
| Chain-of-thought / prompts / payloads never stored | 6 — schema, runtime stream, and a realistic stored trace |
| FileTraceStore persists and reloads | 8 — restart, filtering, malformed entries dropped, engine records untouched |
| CLI displays traces | 7 — list, lookup, unknown id, no leakage |
| CLI does not access TraceStore | 1 — commands scanned with comments stripped |
| A failing trace write cannot break a run | 2 — rejecting and throwing stores, end to end |

## 9. Defects found and fixed

### Found during adversarial verification

**A failing trace write broke a run that had already succeeded.** `run.ts`
awaited `traces.correlate(...)` unguarded, *after* `runner.start` — so by that
line the workflow had run, artifacts existed and an approval may have been
answered. Breaking the store and running the CLI produced a completed run
reporting `Error: disk full` and exiting 1.

The agent runtime already guarded its own trace emission; correlation is the
one trace write that happens outside it, and it was the one left unprotected.
Now swallowed at the call site, with the trade stated in the code: the cost is
an uncorrelated trace, and a degraded record beats a broken run.

This is the exact failure mode the stage brief names — "observer failures must
never break agent execution, workflows, approvals, artifacts" — reached by a
path the unit tests did not cover, because they exercised the runtime's
observer rather than the CLI's own write.

### Found during implementation

**Trace stores threw synchronously from methods typed `Promise<void>`.** Zod's
`parse` runs before the promise is constructed, so a caller that carefully
wrapped `store.create(...)` in `.catch()` would still crash. The same trap the
`project-summary` tool hit in Stage 36 — worth noting as a recurring shape in
this codebase: an `async` keyword is not decoration when the body can throw.

**Stage 36 had no decision-failure event.** A decision refused for carrying
private reasoning or naming a forbidden workflow emitted `started` and then
nothing at all, leaving the most security-relevant case as a dangling record.
`decide` is now wrapped so every refusal closes the trace it opened.

## 10. Known limitations

**Traces are never pruned.** They accumulate in `runs.json` forever. For a
single-user CLI at a handful of runs a day this is a non-issue for years, but
there is no retention policy, and adding one is a product decision nobody has
made.

**`metadata` is the one open field.** Nothing in DesignFlow writes it and a
test asserts our traces leave it empty, but a host embedding the runtime could
put anything there. It is the only place in the trace schema where the
structural guarantee becomes a convention.

**Tool call *inputs* are invisible, by design and at a cost.** A trace shows
that `classify-design-task` was consulted and succeeded, never what it was
asked. When an LLM agent starts calling tools with generated arguments, "it
called the right tool with the wrong input" will be diagnosable only by
reproducing it.

**Correlation is the CLI's responsibility.** `run.ts` calls
`traces.correlate(...)`; a surface that forgets leaves an uncorrelated trace.
The alternative — having `WorkflowRunner` do it — would make the runner aware
of traces, which is the coupling this stage exists to avoid.

**Two observer ports now exist.** `AgentObserver` (Stage 36, synchronous,
in-process, no identity) and `TraceObserver` (durable, correlated). They are
fed from the same emission points, so they cannot disagree, but the redundancy
is real. Collapsing them is the obvious cleanup once nothing depends on the
synchronous one.

**Traces are not shown in `designflow history`.** They are a separate command.
Merging them — "this run was started by a decision that asked one tool" — is
the natural next step and was left out to keep this stage's surface small.
