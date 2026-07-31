# Agent Tool System

**Date:** 2026-07-31
**Status:** Accepted
**Stage:** 36

## Context

Stage 35 gave agents a bounded decision. They could choose from an allow-list,
ask a question, or decline — but they decided blind. Every input to the
decision came from the task, so an agent could not look anything up, and the
Design Engineer's "reasoning" was an if-statement over whether input existed.

Stage 36 gives agents instruments. A tool lets an agent consult bounded
information *while deciding*, and nothing more:

```
Worker → Agent → [tool calls] → AgentDecision → WorkflowRunner → Workflow → Capabilities → Artifacts
```

## 1. Tool is not Capability

The distinction the whole stage rests on:

| | Capability | Tool |
|---|---|---|
| Called by | the engine, as a scheduled DAG node | an agent, inside one `decide()` |
| Appears in | a workflow definition | nothing — no DAG, no plan |
| Produces | artifacts, recorded and content-addressed | a value, discarded once the decision is made |
| Reused | yes — incremental planning skips unaffected nodes | never; a tool call is not memoised |
| Reconciled | yes | not applicable |
| Failure means | the run failed | the agent decides with less information |
| Recorded in | the engine event stream | a product-level observation stream, or nowhere |

**A tool that writes is a capability wearing a disguise.** It would produce
output the engine never recorded, cannot reuse, cannot reconcile and cannot
explain — a second, unaudited execution path with none of the first one's
guarantees. That is why `packages/tools` is checked mechanically for
`writeFile`, `mkdir`, `spawn`, `node:child_process`, `node:net` and `fetch(`:
read-only is only read-only if writing is absent, not merely unused.

The one filesystem tool exists to prove the boundary holds under a real
resource, not because reading directories is the point.

## 2. Why tools live only inside a bounded decision

A tool call is not an execution step, so it must not be able to become one. It
is scoped to a single `decide()` invocation:

- the service is **constructed inside** `decide()` and discarded when it returns
- the **budget lives on that instance**, so it cannot be reset by anything an
  agent does, nor carried into the next decision as spare capacity
- `ToolContext` has **no tools port**, so a tool cannot call a tool — recursion
  is impossible by structure rather than by depth counting
- nothing retries. Whether to try again is a *decision*, which belongs to the
  agent and its budget, not to a layer that would retry invisibly

The single-shot `decide(task, context) → AgentDecision` contract from Stage 35
is unchanged. An agent may now make up to eight tool calls inside that one
invocation; it still returns exactly one decision, and the runtime still
consults it exactly once.

## 3. Why both input and output are validated

Input, because an agent produced it — and an LLM-backed agent will produce it
from a model. Output, because a tool produced it, and whatever a tool returns
came from outside this process: a file, a library, one day a network.

Handing unparsed output to a decision-maker would make the tool's
*implementation* its contract. The manifest's descriptor could say one thing,
the code return another, and the agent would consume whichever it got. Parsing
on the way out means the declared shape is the only shape an agent can ever
see.

Output validation is also what makes tool failure safe. A tool returning
`{taskType: 42}` produces `ERR_TOOL_OUTPUT_INVALID` rather than an agent
branching on a number it expected to be a string.

## 4. Why permissions are per-manifest, and 5. why there is no wildcard

`AgentManifest.allowedTools` is the same discipline as `allowedWorkflows`, one
layer down: what an agent may reach is a list a human wrote and reviewed.
Defaulting to `[]` makes it backward compatible *and* correct — an agent
granted nothing can call nothing, and nothing has to be revoked to keep it so.

There is no wildcard, and the reason is not syntactic. `"*"` is a legal id as
far as the schema knows, so it grants exactly one tool named `*`; a test
asserts that. The reason it is absent is that **a wildcard grant silently
widens the moment a new tool is installed.** It turns "what may this agent do?"
from a question about a reviewed list into a question about install order —
answerable only by knowing what happens to be registered at the time.

That matters most for the case this system exists to survive: an LLM-backed
agent under prompt injection. A reviewed list bounds the blast radius to what
someone approved. A wildcard bounds it to whatever shipped.

**Permission is checked before existence.** An unpermitted call answers
identically whether the tool is installed or not — otherwise the difference
between "not allowed" and "not found" would let a caller enumerate the
installed set by probing.

## 6. Why the agent gets a service port, not the registry

`AgentToolService` has one verb. An agent holding `ToolRegistry` could
enumerate every installed tool and reach the executable object on each, making
the allow-list advisory rather than enforced.

Three things are re-checked on every call, none depending on the agent
cooperating:

1. **the budget** — enforced in the scoped service, before the tool layer
2. **the allow-list** — passed to the invoker *on each call*, never bound once,
   so the enforcing layer is told what is permitted each time rather than
   trusting a scope configured earlier
3. **the schemas** — enforced by the runtime

`AgentContext.availableTools` is pre-narrowed to permitted ∩ installed, but
that is a convenience for a well-behaved agent. A test drives an agent that
ignores it entirely and confirms the tool layer still refuses.

## 7. Why the engine event stream is unchanged

Agent deliberation is not work. It produces no artifact, changes no state, and
a decision ending in `decline` has no execution to attach to. The engine's
event stream is replayed and reconciled to reconstruct what a run *produced*;
its consumers assume every entry belongs to a run.

So observations go to a separate product-level stream with a no-op default.
`packages/core` was not modified in this stage, and a verification pass
confirms the persisted execution store contains zero occurrences of `agent`,
`tool`, `toolId`, `taskType`, `confidence` or any tool or agent id.

The observation schemas are strict and carry **shape, never content**: key
names not values, request *length* not the request, codes and durations not
payloads. That is structural — there is no field to put content in, so the
privacy guarantee does not depend on anyone remembering it.

Observers are synchronous, return void, and their exceptions are swallowed at
both emitting sites. That is the one place in this codebase where swallowing is
correct: an observer that could fail a decision would make adding observability
riskier than going without.

## 8. Why the budget is enforced externally

`maxToolCallsPerDecision` (default 8) lives on the runtime, not in the agent.
An agent asked to respect a budget is an agent trusted to count — and the whole
premise of the layer is that an LLM-backed agent may not.

A malformed call still spends budget. Otherwise an agent could exhaust the
runtime by sending rubbish forever, since a call that fails validation is still
a call.

Exceeding the budget returns a **failure result rather than throwing**. An
exception mid-`decide` would leave the agent with no decision at all; a failure
result lets it return a clarification instead. The tradeoff is that an agent
can loop calling and receiving failures — cheap, since no tool executes, and
bounded by the caller's own timeout.

## 9. How an LLM-backed agent will use this

Nothing structural changes. `decide` becomes a model call; everything around it
already holds:

- the model is told what it may call from `availableTools` and the manifests'
  serializable descriptors — which is why descriptors are JSON-safe rather than
  serialized Zod
- it emits a tool call; the scoped service checks budget and allow-list
- the runtime parses the input, runs with a timeout, parses the output
- the model sees a `ToolResult` it cannot distinguish from any other
- its final answer is parsed by the same strict decision schema and checked
  against the same workflow allow-list

The two properties that matter under prompt injection are already true: a
manipulated model **cannot reach a tool it was not granted**, and cannot reach
a workflow it was not granted. The blast radius is the reviewed list.

## 10. How future tools stay safe

The pattern `project-summary` establishes: **a tool that needs a capability
closes over it, scoped at construction.** The grant appears in the composition
root where it can be reviewed, never in `ToolContext` where every tool would
have it.

| Future tool | Grant it closes over | What keeps it bounded |
|---|---|---|
| Repository inspection | one approved root | `realpath` containment, symlinks skipped, depth and entry caps |
| Design-system lookup | a token catalogue handle | read-only interface; no writes exposed |
| Documentation search | an index handle | query in, results out; no arbitrary path |
| External APIs | a configured client + credential | the tool owns the client; timeouts and output schema unchanged |

None of these requires widening `ToolContext`, and none grants arbitrary
execution. The runtime's guarantees — allow-list, timeout, abort, schema
validation, sanitisation, budget — apply identically whatever the tool does,
because the runtime knows nothing about any of them.

The CLI deliberately ships **without** `project-summary`: it reads a directory,
and the CLI has no directory it is willing to name as safe. A tool needing a
grant does not get one by default.

## 11. Files

**Created**

```
packages/sdk/src/tool.ts                      contracts: manifest, call, result,
                                              Tool, ToolContext, AgentToolService, ToolInvoker
packages/sdk/src/agent-observability.ts       observation schemas, AgentObserver, no-op
packages/tools/                               package.json, tsconfig.json
  src/errors.ts                               10 stable codes + TOOL_ERROR_CODES
  src/registry.ts                             InMemoryToolRegistry
  src/runtime.ts                              ToolRuntime
  src/catalog/classify-design-task.ts         deterministic classifier
  src/catalog/project-summary.ts              bounded read-only filesystem tool
  src/index.ts                                createToolRegistry, builtInTools
packages/agents/src/tool-service.ts           AgentScopedToolService, budget, EMPTY_TOOL_SERVICE
docs/adr/20260731-agent-tool-system.md
+ 5 test files
```

**Modified**

`sdk/agent.ts` (`allowedTools`, `availableTools`, `tools` on the context),
`sdk/index.ts`, `agents/{runtime,registry,errors,index}.ts`,
`agents/catalog/design-engineer-agent.ts`, the CLI's `cli-runner.ts`,
`ui/errors.ts`, `cli.test.ts`, `package.json`, `tsconfig.json`.

`packages/core`, `packages/artifacts`, `packages/state`, `packages/storage-*`,
`packages/product` and every workflow package are **unmodified**.

## 12. Defects found and fixed

### Found during adversarial verification

All four of these are the same class of mistake — **a guarantee read off an
object the guarded party still controls** — and none would have been caught by
testing a well-behaved tool or agent.

**The agent's tool port leaked the invoker.** TypeScript's `private` is
compile-time only; at runtime the fields of `AgentScopedToolService` were
ordinary enumerable properties. An agent could read
`Object.keys(context.tools)`, find `invoker`, and call it directly with any
allow-list it chose. Measured: **100 calls to a never-granted tool against a
budget of 8** — both the permission check and the budget bypassed completely.
This is exactly what a prompt-injected model would find. Fixed with ECMAScript
`#private` fields plus `Object.freeze(this)`: the port now exposes `["call"]`
and nothing else, through keys, `getOwnPropertyNames`, the prototype chain or
`JSON.stringify`.

**A tool could swap its own output schema.** `ToolRuntime` read
`tool.outputSchema` at call time, so a tool could set it to `z.any()` from
inside `execute` and return arbitrary unvalidated output — defeating output
validation on the very call that did it, because the guard and the thing being
guarded were the same object. Fixed by capturing the manifest and both schemas
at registration.

**A tool could widen its own timeout**, by raising `manifest.timeoutMs` from
inside `execute`. Same root cause, same fix.

**Ambient metadata was a cross-call channel.** `Readonly<>` is a type, not a
lock, so a hostile tool could leave state on `ToolContext.metadata` for the
next tool to read. Both runtimes now freeze it.

**Six error codes never said whether anything started** — the first question a
person has after a failure. Now all seventeen do, with a test driven from the
published code enumerations.

### Found during implementation

**The agent registry discarded the manifest it had just validated.**
`register()` parsed the manifest, then stored the agent object with its
*original* one. Zod defaults therefore never reached the runtime — so
`allowedTools`, which is `.default([])`, was `undefined` for any agent whose
manifest omitted it, and the runtime crashed reading `.filter` on it. The check
passed and the value was missing anyway, which is the worst of both. Fixed by
storing the parsed manifest.

This was latent from Stage 35 and only surfaced because `allowedTools` is the
first defaulted field on an agent manifest.

**`project-summary.execute` threw synchronously.** Path-containment failures
escaped before any caller could attach a handler, from a method typed
`Promise<T>`. The tool runtime happened to evaluate it inside a `try`, so it
was caught — but a contract that holds only because of where the caller put its
braces is not a contract. Made `async`.

**The classifier called a bare design file unknown.** `homepage.fig` with no
prose classified as `unknown`, so handing over a design file and saying nothing
produced a clarifying question *about the file just named*. Added a
lowest-priority design-asset rule.

## 13. Tests

**156 new** (29 SDK contracts, 71 tools, 35 agent integration, 21 CLI). Total:
**1176 passing, 0 failing** across 63 files, up from 1020.

| Requirement | Coverage |
|---|---|
| Manifest / call / result validation | 20 — strictness, timeout bounds, no stack or cause field |
| Invalid input and output rejected | 4 — plus "never reaches the tool", "extra keys refused" |
| Registry | 9 — duplicates, incumbent preserved, manifests not tools |
| Authorised call succeeds | 2 — including the restricted context's exact key set |
| Unauthorised / uninstalled | 4 — plus "permission before existence reveals nothing" |
| Timeout enforced | 3 — including a tool that ignores its signal entirely |
| Parent abort propagated | 2 — mid-flight and already-aborted |
| Listener and timer cleanup | 2 — counted add/remove pairs over five calls |
| Failures sanitised | 5 — no stack, collapsed, truncated, non-Error throw |
| Budget enforced outside the agent | 6 — 8 of 20 attempts executed, fresh per decision |
| Context exposes only permitted tools | 3 — plus "the port has one verb" |
| Tool result is load-bearing | 3 — same task, two tool answers, two decisions |
| Tool failure cannot bypass validation | 3 — allow-list and chain-of-thought still refused |
| Legacy workers unaffected | 2 — no agent, no tools, Stage 33 mapping |
| CLI boundary | 6 — no command imports or names a tool |
| Every stable code mapped | 3 — driven from `AGENT_ERROR_CODES` + `TOOL_ERROR_CODES` |
| Filesystem containment | 7 — `../`, symlink escape, dotfiles, secrets, determinism |
| Hostile tool cannot widen its own limits | 5 — schema swap, timeout, id, frozen listing |
| Hostile agent cannot reach the invoker | 4 — keys, prototype, JSON, frozen `call` |
| Cleanup on every path | 7 — success, output-invalid, throw, timeout, cancel, 100-call accumulation |
| Concurrency cannot race the budget | 1 — 50 simultaneous calls spend exactly 8 |

## 14. Known limitations

**The classifier is keyword matching.** Deliberately. Its value is proving the
result is load-bearing; sophistication would obscure that.

**`project-summary` ships nowhere.** It is fully implemented and tested but not
in the CLI's registry, because the CLI has no directory it will name as safe.
It is exercised by tests, not by use.

**Observations are not persisted.** Emitted with a no-op default; nothing
consumes them in the CLI. Persisting them is a product concern and needs a
retention decision that has not been made.

**One tool call per decision, in practice.** The Design Engineer makes exactly
one, confirmed by instrumenting the shipped tool on the real product route. The budget, the multi-call paths and the per-decision scoping are covered
by tests rather than by real use.

**Parallel tool calls are safe, contrary to the note this replaces.** The
counter increments synchronously before the first `await`, and JavaScript runs
that prefix without interleaving, so there is no read-then-write window.
Verified: `Promise.all` of fifty calls against a budget of eight spends exactly
eight and the invoker sees exactly eight.

**`ToolContext.metadata` is unused**, like its agent counterpart. Contract
ahead of use.

**`ERR_TOOL_RESULT_INVALID` is unreachable through the public API.** Every
field the runtime puts on a result is derived rather than taken from the tool,
so no tool can make one invalid. The error class and its code are tested; the
runtime path is a defensive invariant with no trigger.

**Tool failure messages are tool-authored.** The runtime strips stacks,
collapses whitespace and truncates, but a tool that puts a secret in its own
`Error` message would have it surface in a `ToolResult` and an observation.
Tool authors own that; the runtime cannot distinguish a secret from a
description.
