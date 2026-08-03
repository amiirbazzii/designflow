# Design Engineer Specialized Agent Foundation (Stage 2)

**Date:** 2026-08-03
**Status:** Accepted
**Stage:** 2 (Design Engineer improvement roadmap)

## Context

Stage 1 made the Design Engineer worker's existing deterministic
`design-to-code` workflow safe (fingerprint-based reuse), honest (no false
claims about writing files) and inspectable (`designflow artifacts`). It
deliberately did not touch the single-agent, single-workflow shape of the
worker.

Stage 2's goal is to introduce the *infrastructure* for the eventual target
architecture — a coordinator plus three specialized agents (Figma
Specification, Implementation, Visual Validation) — without yet connecting to
real Figma MCP, without real code generation, without writing project files,
without a revision feedback loop, and without regressing anything Stage 1
verified.

## Decision

### 1. The worker keeps one public entry point

`WorkerManifest.agentId` remains a single optional string, unchanged. The
Design Engineer worker's `agentId` now names
`design-engineer-coordinator` instead of `design-engineer-agent`. A person
still only ever sees one worker, "Design Engineer"; the existence of four
agents behind it is not surfaced anywhere in the CLI.

### 2. The old agent is retained, not renamed

`design-engineer-agent` (id, manifest, decision logic, model profile) is
**left completely unchanged** in
`packages/agents/src/catalog/design-engineer-agent.ts`. A new file,
`design-engineer-coordinator.ts`, defines `design-engineer-coordinator` as an
independent manifest that reuses the *same* strategy functions
(`deterministicDesignEngineerStrategy` / `modelDesignEngineerStrategy`) under
its own id, its own version (`0.1.0`), and its own model profile
(`design-engineer-coordinator-default`). Both are registered in the built-in
agent registry (`createAgentRegistry`) simultaneously.

This was the least-disruptive of the two options the roadmap named
("rename and migrate" vs. "retain as alias"). Renaming would have required
either a migration for every place that already recorded
`agentId: "design-engineer-agent"` (a stored session's task/context, a saved
trace, `AgentSessionService.resolveAgentVersion`'s lookups against past
records) or accepting that old references silently stop resolving. Retaining
the old agent costs one extra registration and one extra model profile;
nothing reads it going forward except state that already named it, and it
requires no migration pass at all — the registry simply keeps answering a
name that already existed.

### 3. Four independent agents, four independent model profiles

`packages/agents/src/catalog/` now has:

| Agent id | Responsibility | Model profile id |
|---|---|---|
| `design-engineer-coordinator` | Routes a request to `design-to-code`, asks, or declines | `design-engineer-coordinator-default` |
| `figma-specification-agent` | Fixture snapshot → design specification | `figma-specification-default` |
| `implementation-agent` | Specification + project context → generated implementation | `implementation-default` |
| `visual-validation-agent` | Generated implementation → validation report | `visual-validation-default` |

(`design-engineer-agent` / `design-engineer-default` remain registered as the
retained alias, per §2.)

Every profile is `modelProfileSchema.parse`d independently, next to its
agent, exactly the pattern `design-engineer-agent.ts` already established.
Nothing shares a profile id with anything else; a local `config.json`
override of one profile's `model`/`timeout`/etc. (via the existing
`mergeModelProfileOverrides`) cannot reach any other agent's profile — the
override key *is* the isolation boundary.

### 4. A second kind of agent, and a second registry

The coordinator answers exactly one of three routing outcomes
(`run_workflow` / `request_clarification` / `decline`) — it does not produce
a typed artifact, and `AgentDecisionService`/`AgentRuntime` are unchanged.
The three specialized agents answer a different question entirely:
"produce this typed artifact." Reusing `AgentDecisionService`'s shape for
that would force every specialized agent's real output through a
`run_workflow`-shaped envelope it does not fit.

Stage 2 therefore adds, in `@designflow/sdk`:

- `SpecializedAgent` (`{manifest, perform(request, context)}`) — the
  specialized-agent shape.
- `SpecializedAgentContext` — the same tool/model access shape
  `AgentContext` gives the coordinator (a scoped `AgentToolService`, a scoped
  `AgentModelService`, metadata, signal, logger), with no invocation port at
  all — a specialized agent cannot reach another agent, structurally, not by
  convention.
- `AgentInvocationRequest` / `AgentInvocationOutcome` — the typed request/
  response envelope, mirroring `ModelResult`/`ToolResult`'s
  success/failure discriminated-union shape.
- `AgentInvocationService` — the port a workflow capability calls through.

And, in `@designflow/agents`:

- `InMemorySpecializedAgentRegistry` — a separate registry from
  `InMemoryAgentRegistry`, holding `SpecializedAgent`s rather than `Agent`s,
  with the identical registration discipline (duplicate-id rejection,
  manifest validation, `list()` never exposing the callable).
- `AgentInvocationRuntime implements AgentInvocationService` — the
  specialized-agent twin of `AgentRuntime`: validates the request, resolves
  the agent, narrows its tools/model to what its manifest permits *and* the
  host installed, builds a bounded `SpecializedAgentContext`, calls
  `perform`, and turns whatever comes back — a value or a thrown error —
  into a validated `AgentInvocationOutcome` carrying the agent's id, its
  manifest version, and the model profile actually used.

### 5. Workflow nodes invoke agents; agents never invoke agents

`CapabilityContext` gained one new, optional field: `agents?:
AgentInvocationService`. Every capability written before this stage reads
exactly the context it always did — the field is additive and untouched by
`ExecutionEngine`/`ExecutionService` unless a host supplies an
`agentInvoker`. `packages/core`'s own architecture test (which forbids the
engine from importing `@designflow/agents`, `@designflow/models`, or any
worker/model package) still passes: the engine only ever holds the generic,
SDK-defined `AgentInvocationService` port, exactly the way it already held a
generic `CapabilityReuseResolver`. The concrete `AgentInvocationRuntime` is
constructed only by a composition root — in this stage, only the workflow
package's own test harness constructs one; the CLI's production
`ExecutionService` is not wired to one at all (see §7).

A capability that wants to invoke an agent calls
`context.agents.invoke({agentId, objective, input}, context.signal)`,
receives an `AgentInvocationOutcome`, and — on `type: "failure"` — throws,
which fails that capability's node exactly as any other capability error
does. There is no other path into a specialized agent: it cannot be reached
from another agent, and it cannot be reached outside a workflow node.

### 6. A new, internal workflow proves the wiring — the public one is untouched

Rather than modify `design-to-code` (which Stage 1 fully verified,
including an isolated npm smoke test), Stage 2 adds a second, separately
versioned workflow package member:
`design-to-code-agent-foundation` (`workflows/workflow-design-to-code/src/
agent-foundation-*.ts`), in the *same* package (so it can still depend on
nothing but the SDK, per that package's own architecture test) but with its
own `WorkflowDefinition`, capabilities, and `WorkflowPackage`.

Its five nodes:

```
prepare-figma-source-fixture
  → invoke-figma-specification-agent   → Design Specification Artifact
  → invoke-implementation-agent        → Generated Implementation Artifact
  → invoke-visual-validation-agent     → Visual Validation Report Artifact
  → store-stage-2-summary
```

It is **not** registered in `apps/designflow-cli/src/services/cli-runner.ts`
and **not** named in the Design Engineer worker's `workflows` list — it is
reachable only by workflow id, from a host that explicitly loads it (in this
stage, only `harness.test-support.ts`'s `createAgentFoundationHost`). This
was the spec's own "safer alternative," chosen because it means Stage 1's
public workflow, its approval policy text, and its npm-packaged behaviour are
provably unchanged (verified by re-running the full Stage 1 smoke-test
script against the Stage 2 build — see the final report).

### 7. Reuse identity, without touching the fingerprint engine at all

The hardest requirement was: an agent-version or model-profile change must
invalidate exactly the artifacts that depend on it, nothing more, nothing
less. Stage 1's `buildReuseFingerprint` already hashes
`{capabilityId, capabilityVersion, workflowId, workflowVersion, input,
dependencies, identity}` per node — untouched by Stage 2. Rather than extend
`ReuseIdentity` with a global, execution-wide map of agent versions (which
would fold *every* agent's version into *every* node's fingerprint, breaking
the "only the affected subtree" requirement), each `invoke-*-agent` node's
own `inputMap` names only the one or two workflow-input fields it actually
uses: its own agent's `agentVersion` and (optionally) `modelProfileId`. Those
are ordinary node input — already part of the fingerprint via `input` — so:

- bumping the Figma Specification Agent's version changes only the
  `invoke-figma-specification-agent` node's own input, which changes its
  fingerprint, which changes the artifact it produces, which changes the
  `dependencies` hash of every node downstream of it (the two other
  invocations), and nothing upstream;
- bumping only the Visual Validation Agent's version or model profile
  changes only its own node's input — it is the workflow's terminal
  invocation, so nothing downstream exists to also invalidate, and nothing
  upstream depends on it;
- the large payloads (the Figma snapshot, the design specification, the
  generated implementation) travel exclusively as artifacts via
  `execution.dependsOn`, never through `inputMap` — so an unrelated
  workflow-input change (e.g. the validation threshold moving) invalidates
  only the node that actually reads it.

No change was needed to `engine.ts`'s fingerprint computation, to
`ReuseIdentity`, or to `REUSE_SCHEMA_VERSION` — this is Stage 1's existing
mechanism, applied correctly. See
`workflows/workflow-design-to-code/src/agent-foundation.test.ts`'s "reuse:
agent-version and model-profile isolation" suite for the five scenarios
verified this way.

### 8. Tool and permission isolation

All three specialized agents currently ship `allowedTools: []` — no Figma
MCP tool, no filesystem tool, no browser tool exists yet to grant, so there
is nothing to over-grant. `AgentInvocationRuntime` narrows a specialized
agent's tools and model to the intersection of its manifest's allow-list and
what the host actually installed, exactly the way `AgentRuntime` does for
the coordinator — verified in `invocation-runtime.test.ts` with a fake
two-tool host, proving one agent's manifest allow-list is what the invoker
is actually told on every call, not merely what the agent chooses to
consult.

### 9. What remains unimplemented, on purpose

- No real Figma MCP connection. `prepare-figma-source-fixture` builds a
  deterministic fixture `FigmaSourceSnapshot` from workflow input; nothing
  fetches anything.
- No real code generation or project file writes. `GeneratedImplementation`
  is stored as a DesignFlow artifact, exactly like Stage 1's
  `generate-code`.
- No real screenshot capture or image comparison. `visual-validation-agent`
  evaluates structural completeness of the proposed files, not pixels.
- No revision feedback loop. `RevisionRequest` (§G of the Stage 2 contracts)
  is defined and exported so its shape can be reviewed, but nothing produces
  or consumes one — the workflow this stage ships is a straight line with no
  revision edge.
- No specialized agent is exposed as its own public worker, and no new CLI
  diagnostic command was added (`designflow agents`) — Stage 2's own escape
  hatch ("if adding a public CLI command would expand this stage too much,
  keep diagnostics internal and cover them through tests") was taken; the
  four agents and their registrations are covered entirely through
  `packages/agents`' own test suite.

## Consequences

- The public CLI, its four workers, `design-to-code`'s behaviour, artifact
  inspection, and npm packaging are unchanged and re-verified (full Stage 1
  smoke-test script re-run against the Stage 2 build).
- A future stage wiring real Figma MCP, real code generation, real
  screenshots or the revision loop only needs to: replace
  `prepare-figma-source-fixture`'s fixture construction with a real fetch
  (behind the same `FigmaSourceSnapshot` contract), give the Implementation
  Agent a real write tool (a new, explicitly granted `allowedTools` entry,
  reviewed at that point), give the Visual Validation Agent a screenshot
  tool, and add a `RevisionRequest`-consuming edge back to the Implementation
  Agent. None of that requires touching `AgentInvocationRuntime`, the
  registries, or the reuse-fingerprint mechanism.
- Registering this workflow in the CLI and wiring it to the coordinator
  (replacing `design-to-code` as the worker's default, or teaching the
  coordinator to route to it) is explicitly **not** done in this stage and
  is the natural next step once real Figma/codegen/screenshot integrations
  exist to justify making it the default.
