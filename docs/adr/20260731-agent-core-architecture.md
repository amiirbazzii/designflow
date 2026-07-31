# Agent Core Architecture

**Date:** 2026-07-31
**Status:** Accepted
**Stage:** 35

## Context

Stage 33 gave the product a vocabulary: a person hires a *Design Engineer*
rather than invoking a *design-to-code* pipeline. But a worker was only a name
in front of a pipeline — `workflows[0]`, resolved by a map lookup. It could not
interpret what was asked, choose between ways of doing it, or say "I need more
detail before I start".

The long-term architecture puts a reasoning unit between the two:

```
User → Worker → Agent → Workflow → Capabilities → Artifacts
```

Stage 35 introduces that layer. It introduces **only the contracts and the
runtime boundary** — no tools, no memory, no LLM, no autonomous loops. The
point of doing the boundary first is that everything those later stages add
changes *how a decision is reached*, not what a decision is, so they can arrive
without touching workflow semantics.

## 1. Why agents decide rather than execute

An agent answers exactly one question — "what should happen next?" — and the
answer is a **value**, not a callback:

| Decision | Means |
|---|---|
| `run_workflow` | run this permitted workflow, optionally with this input |
| `request_clarification` | I cannot proceed; here is what I need to know |
| `decline` | I will not do this, and here is why |

A value can be parsed, checked against an allow-list, logged and refused before
anything executes. A callback cannot. That is the whole reason this shape was
chosen over "give the agent a runner and let it orchestrate".

The alternative — an agent that schedules steps, retries them and inspects
results — is a second workflow engine with none of the first one's guarantees:
no DAG, no reuse, no reconciliation, no provenance, no approval gates. The
engine already does that, deterministically, and having two things that
schedule work means the audit trail depends on which one happened to run.

**The test of the boundary:** an agent cannot execute anything, because nothing
it can reach executes anything. `AgentContext` carries four fields —
`availableWorkflows`, `metadata`, `signal`, `logger` — and no repository, no
artifact store, no execution service, no workflow definitions. A test asserts
that key list exactly, and another asserts the whole package never names a
repository, store or runner.

## 2. Why the workflow engine stays deterministic

The engine does not know agents exist. Nothing was added to the event stream,
no execution semantics changed, and `packages/core` was not modified in this
stage at all.

That is deliberate and worth stating as a rule: **a decision is made before
execution starts, and never during it.** Once `WorkflowRunner.start` is called,
the run is the same deterministic DAG execution it was in Stage 31 — same
planning, same reuse, same reconciliation, same replay. An agent chose the
starting point; it has no influence after that.

The consequence is that agent involvement can never make a run
irreproducible. Re-running `design-to-code` with the same input gives the same
result whether an agent selected it or a human typed the id.

## 3. The vocabulary

| | Answers | Is | Executes? |
|---|---|---|---|
| **Worker** | "who can do this?" | product-facing identity, metadata | no |
| **Agent** | "what should be done?" | bounded decision-maker | no |
| **Workflow** | "how is it done?" | deterministic DAG | yes — the authority |
| **Capability** | "what is one unit of work?" | typed, atomic step | yes — within a workflow |
| **Tool** | "what can an agent use while deciding?" | *not implemented — Stage 36+* | no |
| **Artifact** | "what came out?" | immutable, content-addressed output | no |

Relationships:

```
Worker      references at most one Agent      (agentId?: string)
Agent       may choose one permitted Workflow (allowedWorkflows)
Workflow    executes Capabilities
Capability  produces Artifacts
```

**Agent and Tool are different things**, and conflating them is the mistake
this table exists to prevent. A capability is a unit of work the *engine*
schedules, with declared inputs, outputs and artifacts. A tool would be
something an *agent* calls while deciding — a lookup, a search, a probe — that
produces no artifact and appears in no DAG. Stage 35 implements neither tools
nor any placeholder for them.

## 4. Why the runtime is not a loop

`AgentRuntime.decide` consults an agent **exactly once** and returns. A test
counts the calls.

Single-shot is a safety property, not a simplification. An agent that could
re-enter its own decision would be scheduling work, and scheduling work is what
makes something an execution engine. The moment a loop exists, so do the
questions the engine already answers and the agent layer does not: what is the
termination condition, what is the budget, what happens to partial state, what
does replay mean.

Multi-turn clarification is deliberately *not* implemented. When an agent asks
a question, the CLI prints it and stops. Resuming is a conversation-state
problem, and inventing conversation state before there is a second turn to
carry would be designing the interface before the caller.

## 5. Why decisions are validated and workflows allow-listed

Every decision crosses six checks, in order:

1. the task parses (`agentTaskSchema`)
2. the agent resolves
3. a restricted `AgentContext` is built
4. the agent is asked
5. the answer parses (`agentDecisionSchema`)
6. the answer is checked against **both** allow-lists

Two allow-lists, two distinct codes:

| Code | Means |
|---|---|
| `ERR_AGENT_WORKFLOW_NOT_ALLOWED` | the agent chose something its manifest does not permit — a **trust** problem |
| `ERR_AGENT_WORKFLOW_UNAVAILABLE` | the agent chose something this installation lacks — a **deployment** problem |

One code for both would make the first invisible inside the second.

`AgentContext.availableWorkflows` is pre-narrowed to the intersection of
permitted and installed, but **enforcement does not rely on the agent having
read it**. That distinction is what makes the design survive an LLM: the
narrowing is a convenience for a well-behaved agent, and step 6 is the
enforcement for one that is not. A test drives an agent that ignores its
context entirely and asserts it is still stopped.

### No chain-of-thought, enforced rather than documented

Every member of `agentDecisionSchema` is `.strict()`. An agent that attaches
private reasoning under any key — `chainOfThought`, `thoughts`, `scratchpad` —
produces a decision that **fails to parse**, rather than one that quietly
carries it into a log, a transcript or a terminal. Only `reasoningSummary`, a
concise user-safe explanation, has a place to live.

This is the one rule where "we were careful" would have been worthless: careful
is exactly what stops being true once a model is generating the object.

## 6. Where the layers live

```
packages/sdk/src/agent.ts            contracts only — schemas, Agent, AgentContext,
                                     AgentDecisionService, workerAgentWorkflowMismatch
packages/agents/                     InMemoryAgentRegistry, AgentRuntime, errors,
                                     the deterministic Design Engineer agent
packages/product/src/worker-task.ts  WorkerTaskRouter — the product boundary
```

`packages/agents` depends on **`@designflow/sdk` and Zod, and nothing else** —
no core, no storage, no product, no CLI. A test walks the sources and the
package manifest and fails if that changes.

`WorkerTaskRouter` lives in the product layer because it orchestrates *product*
concepts. It takes the SDK's `AgentDecisionService` port rather than
`AgentRuntime`, which is what keeps the product package's SDK-only dependency
true — the same reason `WorkerRegistry` is declared in the SDK and implemented
elsewhere.

**Both paths return the same shape.** A legacy worker's `workflows[0]` mapping
is expressed as a `run_workflow` decision, so a caller cannot tell whether an
agent was involved and could not act differently if it did. Returning a
workflow id for legacy workers and a decision for agent-backed ones would have
made every surface grow a branch, and that branch would have rotted.

## 7. Worker integration, additively

`WorkerManifest` gains one optional field:

```ts
agentId?: string
```

`workflows` stays required. It is what the catalogue advertises, and what an
agent's allow-list is checked against — a worker naming only an agent would be
a promise nobody could verify.

`assertWorkerAgentAlignment` runs when a catalogue is wired, and refuses a
worker advertising workflows its agent may never choose. Caught at startup
rather than on the first run that happens to hit the offending workflow.

**Backward compatibility is total.** A worker with no `agentId` resolves
exactly as it did in Stage 33, consults no agent, and needs no agent runtime
installed. A host with no agents at all still routes.

## 8. CLI integration

The user experience is unchanged. `designflow run design-engineer` still asks
the same three questions and produces the same five artifacts. The path
underneath is new:

```
CLI → context.routeTask() → WorkerTaskRouter → AgentRuntime
    → AgentDecision: run_workflow → WorkflowRunner → design-to-code
```

The CLI **does not know which workflow the agent picked**, does not read an
`AgentManifest`, does not call the registry, and implements no fallback of its
own — a fallback would be the command quietly deciding after the layer that
decides declined to. It handles all three answers and nothing else. Four tests
enforce this: commands may not mention `@designflow/agents`, `AgentRegistry`,
`AgentRuntime`, `AgentManifest` or `allowedWorkflows`; only the composition root
may import the agent package; and the composition root may wire an agent but
never call `.decide(`.

A test also asserts the run transcript never says "agent". That an agent chose
the workflow is machinery a person should not have to learn — exactly as
workflow ids are.

## 9. How later stages plug in without touching the engine

Everything below changes `decide`'s *implementation*. None of it changes what a
decision is, and none of it reaches workflow semantics:

| Later capability | Where it goes | What stays true |
|---|---|---|
| **Tools** | an `AgentContext` field the runtime populates | the decision is still one of three values |
| **Memory** | a service the runtime injects into the context | the runtime still stores nothing itself |
| **LLM-backed decisions** | `decide` becomes a model call | the answer is still strict-parsed and allow-listed |
| **Evaluations** | a stage between step 5 and step 6 | it can only *narrow* what is permitted |
| **Multi-turn clarification** | conversation state above the runtime | `decide` stays single-shot |

The LLM row is the load-bearing one. When `decide` calls a model, everything
downstream of it in `runtime.ts` is unchanged — the model's answer is parsed by
a strict schema and checked against a list a human wrote and reviewed. That is
why the boundary was built before the intelligence.

## 10. Files

**Created**

```
packages/sdk/src/agent.ts                            contracts (27 tests)
packages/sdk/src/agent.test.ts
packages/agents/
  package.json  tsconfig.json
  src/errors.ts                                      six stable codes
  src/registry.ts                                    InMemoryAgentRegistry, alignment check
  src/runtime.ts                                     AgentRuntime
  src/catalog/design-engineer-agent.ts               the deterministic agent
  src/index.ts                                       createAgentRegistry, BUILT_IN_AGENTS
  src/registry.test.ts  src/runtime.test.ts  src/architecture.test.ts   (47 tests)
packages/product/src/worker-task.ts                  WorkerTaskRouter (15 tests)
packages/product/src/worker-task.test.ts
docs/adr/20260731-agent-core-architecture.md
```

**Modified**

`packages/sdk/src/worker-manifest.ts` (optional `agentId`),
`packages/sdk/src/index.ts`, `packages/product/src/index.ts`,
`packages/workers/src/catalog/design-engineer.ts` (names its agent),
`apps/designflow-cli/`: `services/cli-runner.ts`, `commands/run.ts`,
`ui/errors.ts`, `cli.test.ts`, `package.json`, `tsconfig.json`.

`packages/core` was not modified. No engine test changed.

## 11. Tests

**103 new** (27 SDK, 47 agents, 15 product, 14 CLI). Total: **1020 passing, 0
failing** across 56 files, up from 917.

| Requirement | Coverage |
|---|---|
| Manifest validation | 8 — required fields, empty ids, explicit version, ≥1 workflow, duplicates, strictness |
| Duplicate registration refused | 3 — throws, stable code, does not replace the incumbent |
| Registry listing and resolution | 6 — order, manifests not agents, unknown id names what was available |
| Runtime validates decisions | 5 — unknown type, missing field, private reasoning, result key set |
| Workflow outside the manifest | 2 — refused, and the error reports what was permitted |
| Workflow unavailable to the runtime | 2 — distinct code, enforced even when the agent ignores its context |
| Clarification returned safely | 3 — through runtime, router and the CLI |
| Decline returned safely | 3 — through runtime, router and the CLI |
| Legacy workers resolve directly | 5 — no agent consulted, no runtime required |
| Design Engineer resolves to design-to-code | 6 — decision, passthrough, end-to-end run |
| Full path through WorkflowRunner | 2 — history records `design-to-code`, exit code 0 |
| CLI does not touch the agent layer | 4 — commands, non-root sources, composition root never decides |
| Agents package imports nothing but the SDK | 5 — sources, manifest, no store/runner/LLM names |
| No chain-of-thought persisted or exposed | 3 — schema, runtime, returned key set |
| Agent failures stay in the user's vocabulary | 3 — every code mapped, no leakage, each actionable |

The packaged smoke test (`npm pack` → `npm install -g` → run under Node) passes
unchanged.

## 12. Defect found during verification

**Agent error codes were unmapped in the CLI's error table.** All seven
(`ERR_AGENT_*` plus `ERR_AGENT_RUNTIME_UNAVAILABLE`) fell through
`ui/errors.ts` to the raw `DesignFlowError` message, so a user would have seen:

```
Agent design-engineer-agent may not run workflow: some-other-workflow

Try  designflow --help  , or set DESIGNFLOW_DEBUG=1 to see the full details.
```

That leaks the agent id, the workflow it reached for and the existence of the
agent layer — contradicting both this stage's boundary and `ui/errors.ts`'s own
stated contract ("in the user's terms, not the engine's"). The happy-path test
asserting the transcript never says "agent" did not cover failure paths.

Fixed by mapping all seven codes, with three tests asserting every code is
mapped, leaks no agent vocabulary or internal id, and still says what to do
next. This matters more in Stage 36 than now: with the shipped deterministic
agent an invalid decision is impossible, but an LLM-backed agent will produce
one eventually.

## 13. Known limitations

**The agent is not intelligent, and is not pretending to be.** It has one
permitted workflow, so "choosing" is not yet a decision worth making. What it
proves is the path, and every step of that path — delegation, validation,
allow-listing — is real.

**One agent, one worker.** Multi-agent anything, agent-to-agent messaging and
user-created agents are explicitly out of scope, so the registry's multi-agent
behaviour is exercised by tests rather than by use.

**Clarification is a dead end, and unreachable with the shipped worker.** The
CLI prints the question and stops; there is no way to answer it without
re-running the worker, because there is no conversation state — deliberately,
since Stage 35 forbids a multi-turn loop. Separately, `collectInput`
substitutes a field's placeholder for a blank answer, so the Design Engineer's
form always produces input and the shipped agent never asks. The path is real
and tested, but only a worker that collects no input can currently reach it.

**Decisions are not observable.** Nothing is persisted and nothing reaches the
event stream, per the stage's constraint that the engine must not learn agents
exist. A run started by an agent is indistinguishable in history from one
started directly. A product-level decision log is the natural next step, and it
belongs outside core.

**`request` is synthesised in the CLI.** `run <worker>` has no free-text
prompt, so `describeRequest` flattens the collected form into `"key: value"`
pairs. That is honest but thin — it is a serialised form, not something a
person said. A real prose request needs a prompt the CLI does not yet have.

**The alignment check runs only at wiring time.** A worker registered *after*
`createCliContext` — as tests do — is not checked against its agent. The
runtime's per-decision enforcement still applies, so the safety property holds;
only the early warning is missed.

**`AgentContext.metadata` is unused.** Nothing populates it beyond the CLI's
empty default, and `instructions` is inert — no code reads it. Both are carried
because they are part of the manifest's identity, but they are contract ahead
of use, which is the one place this stage deliberately broke the
no-speculative-abstraction rule.

**Two error codes were added beyond the brief's list**
(`ERR_AGENT_WORKFLOW_UNAVAILABLE`, `ERR_AGENT_RUNTIME_UNAVAILABLE`). The brief
said "codes such as", and collapsing either into an existing code would have
hidden a distinct failure — see §5.

**Only the CLI speaks agent.** The web app, demo and API still resolve
workflows directly and do not use `WorkerTaskRouter`. They work unchanged, but
the vocabulary is now inconsistent across surfaces — the same gap Stage 33 left
for workers, now one layer deeper.
