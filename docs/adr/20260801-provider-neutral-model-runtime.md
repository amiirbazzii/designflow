# Provider-Neutral Model Runtime and Per-Agent Model Profiles

**Date:** 2026-08-01
**Status:** Accepted
**Stage:** 38

## Context

Stage 35 gave agents a bounded decision. Stage 36 gave them tools. Stage 37
made both observable. Every stage since 35 has said the same thing in its
"known limitations": the Design Engineer's reasoning is an if-statement, and
the day it becomes a model call, the architecture built so far has to survive
contact with something genuinely untrusted — a real LLM, under a real
provider's real failure modes, possibly under prompt injection.

Stage 38 is that day. Two decisions were mandatory going in: OpenRouter as the
first concrete gateway, and no agent forced to share a model with any other.
Everything else in this ADR is about keeping those two decisions from becoming
the same decision — a provider-neutral core with OpenRouter as one interchangeable
implementation, and a per-agent reference that never widens into a global default.

```
Worker → Agent → Agent-specific Model Profile → Model Runtime → Model Provider
       → OpenRouter → Selected model → Structured, validated model result
       → AgentDecision → WorkflowRunner
```

## 1. Why OpenRouter is the initial provider

OpenRouter is a gateway, not a vendor: one HTTP surface routes to many
underlying models, with an OpenAI-compatible request shape most existing
tooling already understands. That made it the fastest way to prove the
*architecture* — provider-neutral core, per-agent profile, structured output,
sanitised errors — against something real, without betting the shape of
`ModelProvider` on any one vendor's SDK quirks.

It is explicitly "the initial provider," not "the provider." Nothing about
`ModelRuntime`, `ModelProfile`, `AgentManifest`, or the agent layer knows
OpenRouter exists — see §9 for what adding a second provider actually
requires, which is the real test of whether this claim holds.

## 2. Why the model runtime stays provider-neutral

Because the alternative — a `ModelProvider` interface shaped around
OpenRouter's specific request format — would make "swap providers" mean
rewriting `ModelRuntime`, not writing a new package. The neutral contracts in
`packages/sdk/src/model.ts` (`ModelRequest`, `ModelResponse`, `ModelMessage`,
`ModelProfile`) describe what *any* chat-completion-shaped LLM call needs:
messages, a model slug, a JSON Schema for structured output, bounded
temperature and token limits. OpenRouter's specific routing and fallback
vocabulary lives in `providerRouting`/`fallbackModels` — typed, but understood
only by providers that choose to read them; a future provider that ignores
them loses nothing it needed.

`@designflow/model-provider-openrouter` is consequently a small package: it
translates the neutral request into an HTTP call and translates the answer
back. It owns zero policy — no timeout, no retry, no cancellation — all of
which live in `ModelRuntime`, applied identically no matter which provider is
plugged in.

## 3. Why every agent owns an independent model-profile reference

`AgentManifest.modelProfileId` is optional and per-agent, mirroring
`allowedWorkflows` and `allowedTools` one layer up. The reference is inert
data — a string naming a profile — never a live configuration; resolving it to
an actual provider and model happens fresh at call time, in `ModelRuntime`,
which is what lets the same manifest run against a different model in a test
with zero agent code changed.

Ownership at the agent level is what makes the two example agents in the
brief (`design-engineer-agent → design-engineer-default`, a hypothetical
`research-analyst-agent → research-analyst-default`) genuinely independent:
each name resolves through the same registry, but nothing about resolving one
touches the other. `mergeModelProfileOverrides` (§ Configuration Precedence)
patches by profile id, not by agent — changing one agent's assigned model
edits exactly one entry in the profile registry.

## 4. Why no mandatory global model exists

A global default is the single easiest way to accidentally couple every
agent's behaviour to one vendor's uptime, one vendor's pricing, and one
vendor's failure modes — and to make "test agent B with a cheaper model"
mean touching agent A's configuration to avoid disturbing it. There is no
field anywhere in this stage's contracts for "the model," only "the model
*this profile* names." An agent with no `modelProfileId` has no model access
at all — not a fallback to some default, an absence — enforced by
`EMPTY_MODEL_SERVICE`, which every `generate()` call answers with
`ERR_MODEL_PROFILE_NOT_FOUND`.

## 5. Agent, Model Profile, Model Runtime, Model Provider, OpenRouter, Tool, Workflow

| | Answers | Lives in | Knows about |
|---|---|---|---|
| **Agent** | "what should happen next?" | `@designflow/agents` | its own manifest, its tools, its one model profile |
| **Model Profile** | "which model, at what settings?" | data — a `ModelProfile` record | a provider id and a model slug; nothing executable |
| **Model Runtime** | "resolve, enforce policy, call, validate" | `@designflow/models` | profiles and providers; nothing about agents |
| **Model Provider** | "how do I reach this vendor's API?" | one package per vendor | HTTP, auth, response shape; nothing about agents or workflows |
| **OpenRouter** | one concrete `ModelProvider` | `@designflow/model-provider-openrouter` | its own HTTP API only |
| **Tool** | "what fact should inform this decision?" | `@designflow/tools` | its own bounded operation; called by an agent, not by a model |
| **Workflow** | "how is the work actually done?" | the engine | capabilities, artifacts; nothing about agents, tools or models |

The row worth dwelling on is Tool vs Model. A tool is deterministic,
cheap, and called *by agent code* with a fixed shape. A model is
non-deterministic, comparatively expensive, and called with a request the
agent assembles from a bounded prompt. Both are consulted while deciding, and
neither executes a workflow — but a tool's output is trusted enough to branch
on directly (Stage 36), while a model's output is trusted *only* after
`modelDecisionSchema` re-parses it (§6). That asymmetry is deliberate: a tool
is code a human wrote; a model's answer is content a human did not write and
must not be assumed safe.

## 6. Why provider output is locally validated even with structured outputs

OpenRouter's `response_format: json_schema` is a *request* to the underlying
model, not a guarantee about the process producing DesignFlow's output. Three
independent things can go wrong even when the provider claims success: the
model can ignore the schema, an intermediary can transform the response, and —
the case this system is built to survive — a prompt-injected model can produce
a *structurally valid* answer that names a workflow it should never have been
allowed to name.

So validation happens twice, at two different layers, checking two different
things:

1. **`ModelRuntime`** validates the *envelope* — does this look like a
   `ModelResponse`? It has never seen `modelDecisionSchema` and never will;
   that would couple the neutral runtime to one caller's idea of a decision.
2. **The caller** (`modelDesignEngineerStrategy`) validates the *content* —
   `modelDecisionSchema.safeParse(result.output)` — against the exact strict
   schema it asked for, with no `input` field for the model to smuggle
   workflow input through (§ Structured Agent Decisions).

Then a third check, unrelated to either: the resulting `AgentDecision` still
passes through `AgentRuntime.enforce()` — the same `allowedWorkflows` check
every decision faces, model-backed or not. A model that returns a structurally
perfect `run_workflow` for a workflow outside the agent's allow-list is
refused exactly as if a hostile deterministic agent had tried the same thing.
Test evidence: `model-integration.test.ts`'s "workflow allow-listing still
applies to a model-influenced decision."

## 7. Why prompts and completions are absent from traces

Stage 37 already answered this for reasoning summaries and tool payloads; this
stage extends the same answer to messages and structured output. A trace
records **who decided, when, how long, which provider and model, and whether
it worked** — `traceModelCallSchema` has no field for a message, a prompt, or
`output`. That is structural, not a convention someone has to remember: the
schema is `.strict()`, so a collector that tried to attach a completion would
fail to construct a valid trace at all.

**Model names are the one exception, and it is deliberate.** `providerId` and
`model` — e.g. `openai/gpt-4o-mini` — are stored on both the trace and every
`model.request.*` event. They identify *which configuration decided*, the same
category of fact `workflowId` already was; withholding them would make a
trace useless for the one thing this stage exists to support — telling two
model assignments apart after the fact (§10). They are provider/version
metadata, not user content, and the existing privacy policy (Stage 37) never
classified configuration facts as sensitive — only prompts, reasoning, and
payloads.

## 8. Why deterministic strategies remain available for tests

`DesignEngineerStrategy` is a plain function type — `(task, context,
manifest) => Promise<AgentDecision>` — and `createDesignEngineerAgent(strategy)`
is the only place mode is selected, once, at construction. There is no branch
inside `decide()` that inspects an environment variable or falls back after a
failed model call; the strategy *is* the mode, chosen before the agent exists.

This is what makes "the deterministic implementation must remain available for
unit tests, offline tests, environments without an API key" true without any
special-casing: `designEngineerAgent` (the default export) is always
`createDesignEngineerAgent(deterministicDesignEngineerStrategy)`, unaffected
by anything Stage 38 added. Every test written for Stage 35–37 keeps passing
unmodified against it. A test that specifically wants model behaviour
constructs `createDesignEngineerAgent(modelDesignEngineerStrategy)` with an
injected fake `ModelInvoker` — explicit dependency injection, the highest tier
in the configuration precedence (see below) — and never touches a network.

### Configuration precedence, concretely

1. **Test-only explicit dependency injection** — a test constructs a
   `ModelProfile`, a fake `ModelInvoker`, or passes
   `modelDesignEngineerStrategy` directly. Nothing else in this list runs.
2. **Local `config.json` override** — `settings.models.profiles.<id>`,
   read by `readModelProfileOverrides` and applied by
   `mergeModelProfileOverrides`, field-wise, per profile id.
3. **The registered profile's own default** — `designEngineerDefaultModelProfile`,
   owned by the agent package that declares the agent, not by the CLI.
4. **No implicit fallback.** A profile id with neither an override nor a
   default resolves to nothing — `ERR_MODEL_PROFILE_NOT_FOUND` — never a
   guessed model.

Mode itself (deterministic vs model) is decided once, at CLI wiring time, by
whether `OPENROUTER_API_KEY` is set in the environment — not part of this
precedence chain, and covered in its own section below.

## 9. Adding a future provider without changing `AgentManifest` semantics

`AgentManifest.modelProfileId` names a profile; a profile names a
`providerId`; the provider id resolves through `InMemoryModelProviderRegistry`
to whatever implements `ModelProvider`. None of that chain mentions
OpenRouter by name except the one profile that happens to reference it.

Adding `@designflow/model-provider-anthropic` tomorrow means:

1. Implement `ModelProvider` — translate `ModelRequest` to Anthropic's API,
   translate the response back, throw the recognised `ERR_MODEL_*` codes on
   failure (§ Stable Model Errors).
2. Register it: `providers.register(new AnthropicProvider({apiKey}))`.
3. Point a profile at it: `{providerId: "anthropic", model: "claude-..."}`.

`AgentManifest` does not change. `AgentContext.model` does not change. The
Design Engineer's prompt builder does not change. Every existing agent keeps
working exactly as configured, because a profile — not a provider — is what an
agent references, and switching an agent to a new provider is a one-line
profile edit, not a code change.

## 10. How future model evaluation can compare profiles per agent

Every field an evaluation needs is already typed and already collected:
`profileId`, `providerId`, `model`, `durationMs`, `usage`, and — from Stage
37's `decisionType`/`status` — the *outcome* of each decision. Nothing about
the trace schema needs to grow for a first evaluation pass:

```ts
const traces = await service.listTraces({ agentId: "design-engineer-agent" });
const byModel = groupBy(traces, (t) => t.modelCalls[0]?.model);
// clarification rate, decline rate, and mean durationMs, per model — from
// stored fields alone, no payload access required.
```

Comparing *two profiles for one agent* (`design-engineer-default` pointed at
model A this week, model B next week, via a local config override) is already
supported end to end — the override changes which model the trace's
`modelCalls[].model` records, so a before/after comparison is a filter over
existing data. A dedicated multi-profile-per-agent evaluation harness — running
the *same* request against two profiles simultaneously and diffing the
decisions — is future work, deliberately out of scope here (Stage 38
forbids "automatic best-model selection"), but it would consume this same
trace shape rather than requiring a new one.

## 11. Files

**Created**

```
packages/sdk/src/model.ts                    ModelProfile, ModelRequest/Response/Result,
                                              ModelProvider, ModelInvoker, AgentModelService
packages/models/                              package.json, tsconfig.json
  src/errors.ts                               15 stable codes
  src/profile-registry.ts                     InMemoryModelProfileRegistry
  src/provider-registry.ts                    InMemoryModelProviderRegistry
  src/runtime.ts                              ModelRuntime
  src/config.ts                               mergeModelProfileOverrides
  src/index.ts
packages/model-provider-openrouter/           package.json, tsconfig.json
  src/provider.ts                             OpenRouterProvider
  src/index.ts
packages/agents/src/model-service.ts          AgentScopedModelService, EMPTY_MODEL_SERVICE
packages/agents/src/decision-prompt.ts        buildDecisionPrompt, modelDecisionSchema
apps/designflow-cli/src/services/model-config.ts   local override reading
apps/designflow-cli/src/model-mode.test.ts
apps/designflow-cli/src/live-openrouter.test.ts
docs/adr/20260801-provider-neutral-model-runtime.md
+ 8 more test files across sdk/models/model-provider-openrouter/agents/product
```

**Modified**

`sdk/agent.ts` (`modelProfileId`, `AgentContext.model`), `sdk/trace.ts`
(`traceModelCallSchema`, three `model.request.*` events, `modelCalls` field),
`sdk/index.ts`, `agents/runtime.ts` (model wiring, budget, trace emission),
`agents/errors.ts` (`ERR_AGENT_MODEL_BUDGET_EXCEEDED`), `agents/index.ts`,
`agents/catalog/design-engineer-agent.ts` (strategy split),
`agents/architecture.test.ts` (updated for Stage 38's intentional model
capability), `product/traces.ts` (model call collection), the CLI's
`cli-runner.ts`, `ui/errors.ts`, `ui/terminal.ts`, `commands/settings.ts`.

`packages/core`, `packages/artifacts`, `packages/state`, `packages/tools`,
`packages/storage-file` (beyond the pre-existing `FileTraceStore`, unmodified
this stage) and every workflow package are **unmodified**.

## 12. Tests

**~155 new** across ten files: SDK contracts (21), `packages/models` (43: 6
profile/provider registry, 37 runtime), the OpenRouter provider (27, against a
real local HTTP server), the decision prompt builder (19), the agent-side
model service (13), generic model-runtime integration (10), the Design
Engineer's model strategy (13), extended tracing (16 new, 26 total), extended
product trace collection (5 new), and CLI model-mode behaviour (17) plus a
gated live test.

| Requirement | Coverage |
|---|---|
| Profile/request/response strict validation | 21 — including "no field for a credential" and "no wildcard provider" |
| Registries: registration, duplicates, resolution | 11 |
| Runtime: correct provider resolved per profile | agent A / agent B distinct, changing one leaves the other untouched |
| Timeout, cancellation, cleanup | mirrors `ToolRuntime`'s proven pattern exactly |
| Auth / rate-limit / unavailable normalisation | 3, plus "unrecognised code collapses to PROVIDER_FAILED" |
| No raw response, secret or stack survives | 2, against a real HTTP failure body |
| OpenRouter: exact model, exact schema, fallback only when configured | 8, against a real server capturing the request |
| Credential never logged/persisted | 4, including "never in the returned ModelResponse" |
| Model output is load-bearing | same task, three model answers, three different decisions |
| No silent fallback to deterministic on model failure | explicit — decline, not a re-run of the classifier logic |
| Workflow allow-list survives a model-backed decision | 2 |
| Traces carry no prompt, completion, or secret | model-runtime-level and product-collector-level, both |
| CLI: only the composition root reads the env var / imports the provider | 3, source-scanned |

## 13. Defects found and fixed during implementation

**A hardcoded worker-shaped string in the composition root.** The first draft
of `BUILT_IN_MODEL_PROFILES` in `cli-runner.ts` literally wrote
`id: "design-engineer-default"` — caught by a pre-existing Stage-33 regression
test (`shell.test.ts`, "no worker id appears in any printable string in the
CLI") that forbids the composition root from naming a worker by hand, because
the registry is supposed to be the single source of truth. Fixed by moving
ownership of the default profile to `packages/agents` itself —
`designEngineerDefaultModelProfile`, exported beside the manifest that
references it — so the CLI only ever *imports* a profile, never reconstructs
one.

**An obsolete architecture test.** `packages/agents/src/architecture.test.ts`
asserted "carries no LLM… dependency" via a blanket substring match for
`"openai"`, written when Stage 35 explicitly deferred model calls. Stage 38 is
that later stage, and the Design Engineer's real default model slug
(`openai/gpt-4o-mini`) legitimately contains that substring as vendor-prefix
*data*, not a package import. Updated the test to check import specifiers
specifically (no `@ai-sdk/`, no `openai`/`@anthropic-ai/`/`langchain`
*package*, no direct `fetch(` call) — the actually-load-bearing guarantee —
rather than a string anywhere in the file.

## 14. Known limitations

**One tool call, one model call, no interleaving.** The Design Engineer
consults the classifier once, then the model once. Nothing prevents a future
agent from alternating, but the trace ordering tests only cover the sequence
this stage actually produces.

**`ModelRuntime` has no cross-provider fallback of its own.** Fallback models
are sent to *one* provider (`fallbackModels` in the OpenRouter request body);
there is no runtime-level "try provider A, then provider B" — that would be
exactly the kind of automatic behaviour the brief forbids, so it is absent by
design rather than by oversight.

**The model-call budget (default 3) is a Stage 38 addition beyond the brief's
minimum error list**, mirroring `ERR_AGENT_TOOL_BUDGET_EXCEEDED`'s precedent
from Stage 36 — defense in depth for a call an agent's own code makes, not
something the brief's testing section names directly. Documented here since it
is a real behavioural addition.

**Usage-based cost is provider-reported only.** `ModelUsage.cost` is whatever
OpenRouter includes in its response, when it includes it; there is no
independent cost calculation or budget enforcement based on spend.

**No settings write path for model profiles.** `designflow settings` displays
assignments; changing one still means hand-editing `config.json`, consistent
with the existing "no interactive settings editor yet" position from Stage 34
onward.

**The live OpenRouter test is unexercised in this report.** It requires a real
credential this environment does not have; its gating (`OPENROUTER_API_KEY`
non-empty *and* `DESIGNFLOW_LIVE_MODEL_TEST=1`) was verified to correctly skip
by default, and its logic was reviewed but not run end-to-end against the
real API.
