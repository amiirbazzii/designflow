# Design → Code Workflow

**Date:** 2026-07-28
**Status:** Accepted
**Stage:** 29

## Context

Stages 1–28 built an engine, an intelligence layer and a product surface. All
of it was proven against synthetic workflows — `workflow-test` runs a single
node that writes a string. Nothing had yet shown that the pieces compose into
something a person would want.

Stage 29 is that proof: a real vertical workflow, built only from public
contracts, that a user starts, watches, approves and re-runs.

## Architecture

The workflow is a **consumer** of the platform, not part of it.

```
@designflow/sdk          contracts only
        ▲
        │ depends on
        │
@designflow/workflow-design-to-code      ← this stage
        │
        │ registered into, at runtime
        ▼
@designflow/core  ──emits──▶  @designflow/product  ──▶  UI / API / CLI
```

`workflows/workflow-design-to-code` depends on `@designflow/sdk` **only**. It
never imports core, and it does not import the product layer either. The
manifest's `load(registry)` is handed a registrar rather than looking one up,
which is what keeps the dependency pointing one way.

The integration tests do need an engine — proving the workflow runs means
running it. `harness.test-support.ts` is the single file that wires one, it is
a `devDependency`, and `tsconfig` excludes it from the build. The published
`dist/` contains no reference to core, verified after building.

## Workflow Design

A five-node linear pipeline, matching the compiler-pass model in §2.3 of the
constitution:

| Node | Produces | Reads |
|---|---|---|
| `analyze-design` | `design-analysis` | the run's input |
| `extract-design-tokens` | `design-tokens` | `design-analysis` |
| `create-component-structure` | `component-tree` | `design-analysis`, `design-tokens` |
| `generate-code` | `source-code` | `component-tree` |
| `validate-output` | `validation-report` | `source-code` |

Two properties make this incremental rather than merely sequential.

**Every node declares what it `produces`.** That is what lets the Stage 24
planner compute which nodes a change actually invalidates. Without it every
re-run is a full run.

**Capabilities are pure functions of their inputs.** No timestamps, no
randomness. This is load-bearing, not tidiness: Stage 22 versions an artifact
by comparing a re-emission's metadata against the previous version, so a
capability that varied run to run would report a change every time and make
reuse impossible. The determinism is what makes "nothing changed" observable.

**Nodes never hand each other values.** Each one looks its dependency up in
`context.parentArtifacts`, loads the payload through the artifact store, and
writes its own. The dependency is therefore visible in the lineage graph, and a
skipped node's adopted artifact resolves exactly like a freshly produced one —
which is what lets the reuse machinery work without the capabilities knowing it
exists.

## Decisions

### 1. Two identities per artifact

`ArtifactStore.save` returns a **content-addressed** id: it changes whenever
the bytes change. That is right for storage and wrong for identity — "the
design tokens of this project" needs a name that survives a change, because
incremental planning has to say *tokens changed* and versioning has to know v2
succeeds v1 of the same thing.

So each capability does both: it saves the payload (content-addressed), and
returns a reference under a **stable logical id** (`design-tokens`) whose
metadata points at the stored payload.

The cost is real and measurable: **ten artifact registrations for five
conceptual outputs**, because the payload blob is itself a registered artifact.
A test pins that number so it cannot drift unnoticed. The alternatives are
worse — content-addressed ids alone break incremental planning, and putting
payloads in reference metadata would put them into checkpoints, which Stage 22
explicitly forbids. A future refinement would let a store mark payload-only
artifacts as internal so product counts show five.

### 2. The reference's metadata is the change signal

`writeArtifact` takes a `summary` that becomes the reference's metadata, and
the engine compares it to decide whether a re-emission is a new version. It is
derived only from the payload — a timestamp there would defeat the entire
incremental story. The rule is documented at the function that enforces it.

### 3. The approval gate ships as data

`designToCodeApprovalPolicy` is exported alongside the workflow rather than
wired into it. `generate-code` is the pipeline's only `write_fs` capability —
the step that would put files into a project — so it is the one worth a
person's attention. Whether a given deployment gates on it is a host decision,
and `ExecutionService` already knows how to evaluate and enforce a policy.

Note the gate fires **before** the workflow starts, not immediately before the
`generate-code` node: policy is evaluated per execution. The user experience is
"approve this run because it will write files", which is the right question,
but it is not a mid-run pause. A per-node gate would need engine support that
does not exist and was not added.

### 4. The reuse resolver is the host's, and it is required

The harness supplies a `CapabilityReuseResolver` that reuses a node's prior
output when the change set does not reach it, answering *reach* with
`ArtifactIntelligenceService.analyzeImpact` — so the reuse decision and the
planner's skip decision derive from the same lineage graph and cannot disagree.

Writing this exposed that it is **not optional**. The first draft wired the
planner, materializer and reconciler but no resolver; the second run skipped
`analyze-design` and then `generate-code` failed with a missing upstream
artifact — precisely the gap Stages 24 and 25 documented. Planner without
resolver is not a degraded mode, it is a broken one for any workflow whose
nodes consume upstream artifacts.

## Files Created

```
workflows/workflow-design-to-code/
  package.json                     sdk dependency; core+product are devDependencies
  tsconfig.json                    excludes *.test.ts and *.test-support.ts
  src/types.ts                     5 artifact payload schemas, input schema, id maps
  src/artifact-io.ts               readArtifact / writeArtifact — the only channel
  src/capabilities/index.ts        the 5 capabilities
  src/workflow.ts                  definition + recommended approval policy
  src/manifest.ts                  WorkflowPackage
  src/index.ts                     barrel
  src/harness.test-support.ts      a wired host (test-only, excluded from build)
  src/index.test.ts                31 tests
```

One product-layer fix was needed (`packages/product/src/narration.ts`) — see
Consequences.

## Example User Journey

```ts
const execution = await runner.start({
  workflowId: "design-to-code",
  input: { designFile: "homepage.fig", framework: "react",
           frames: ["brand/Header", "brand/Footer", "layout/Sidebar"] },
});
// → { state: "needs_approval" }   (with the approval policy configured)

await runner.status(execution.executionId);
// → "Needs your approval — Approval required by policy rule
//    \"approve-code-generation\""

await runner.approve(execution.executionId, "reviewed the diff");
// → { decision: "approve", state: "ready" }

await runner.progress(execution.executionId);
// → 5/5, steps: Analyze design ✓ · Extract design tokens ✓ ·
//    Create component structure ✓ · Generate code ✓ · Validate output ✓

await runner.explain(execution.executionId);
// → narration: Started workflow · Planning workflow · Running workflow steps
//    · … · Completed successfully
// → artifacts: "Design tokens" by extract-design-tokens,
//    depends on "Design analysis"
```

Re-run after changing only the generated code:

```
Analyzed dependencies — 2 steps to run, 3 up to date
Reused 3 existing artifacts
Validated final artifact state — 3 reused
```

## Consequences

- `workflows/workflow-design-to-code` is new and self-contained.
- **One product-layer bug was found and fixed.** Narration aggregated only
  *consecutive* identical events, and the materializer's silent
  `artifact.materialized` sits between each `artifact.reused` — so three
  reuses narrated as "Reused 1 existing artifact" three times. Silent events
  are now filtered before grouping. A synthetic workflow never produced that
  interleaving; a real one did immediately.
- The engine is untouched. No file under `packages/core` or `packages/sdk`
  changed in this stage.
- The workflow's "design file" is a list of frame names. Parsing a real Figma
  file is a capability implementation detail that would pull a domain SDK into
  the package; the pipeline shape and the incremental behaviour are what this
  stage set out to prove.

## Migration Notes

### To run it

```ts
const registry = new CapabilityRegistry();
designToCodeWorkflowPackage.load(registry);

const service = new ExecutionService({
  workflowResolver: (id) =>
    id === "design-to-code" ? designToCodeWorkflowPackage : undefined,
  capabilityRegistry: registry,
  /* …logger, artifactStore, executionRepository, eventPublisher… */
  policy: designToCodeApprovalPolicy,     // optional gate
  policyEvaluator: new InMemoryPolicyEvaluator(),
});
```

`harness.test-support.ts` is a complete worked example, including the
incremental wiring.

### To make a workflow incremental

Four things, all of which this workflow demonstrates:

1. Declare `produces` on every node.
2. Keep capabilities deterministic — no timestamps or randomness in anything
   that reaches artifact metadata.
3. Wire planner **and** reuse resolver **and** materializer **and**
   reconciler. The planner alone will skip nodes without supplying their
   artifacts, and dependents will fail.
4. Pass `changedArtifacts` and `previousExecutionId` in execution metadata.

### For workflow authors

Copy the `readArtifact` / `writeArtifact` pair. Passing values between nodes
any other way removes the lineage edge the planner reasons about, and reuse
silently stops working.
