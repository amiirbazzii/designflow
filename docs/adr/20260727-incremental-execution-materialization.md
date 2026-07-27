# Incremental Execution Materialization

**Date:** 2026-07-27
**Status:** Accepted
**Stage:** 25

## Context

Stages 23–24 built the incremental loop in two halves, and the Stage 24 review
follow-up joined them: the planner decides a node needs no computation, the
reuse resolver supplies artifacts in its place, and the engine only honours a
skip once those artifacts arrive.

What the engine did with them was thin. It checked each adopted id existed in
the registry and then injected **the resolver's own reference object** into the
DAG. That leaves three gaps between a planned skip and a real execution:

- The injected `type` and `metadata` were whatever the resolver claimed. A
  resolver returning `{ id: "figma-json", type: "test" }` for an artifact
  registered as `figma.json` put a wrong reference into every downstream node's
  `parentArtifacts`.
- Version records were never consulted. An artifact header pointing at a
  version with no record passed the existence check.
- The check was inline engine code, so a host could not substitute its own
  resolution strategy without forking the engine.

The goal of this stage: a planned skip must produce downstream behaviour
equivalent to having executed the node.

## Decision

### 1. Materialization is a third contract, not more engine code

`ArtifactMaterializer` (SDK) has one method. The incremental loop is now three
questions with three owners:

| Question | Owner |
|---|---|
| Does this node need computation? | `IncrementalExecutionPlanner` |
| Can we reuse instead of computing? | `CapabilityReuseResolver` |
| Are these artifacts real and usable? | `ArtifactMaterializer` |

The split matters because the answers have different authorities. Reuse is
*policy* — a host's cache decides it. Materialization is *fact* — the registry
decides it. Folding fact into the policy contract would let a resolver assert
an artifact into existence, which is exactly the failure mode the Stage 23
integrity check was added to prevent.

A materializer is strictly read-only: it never executes a capability, creates
an artifact, or mutates the registry.

### 2. References are rebuilt from the registry, not trusted

`RegistryArtifactMaterializer` discards the resolver's reference object and
reconstructs each one from the registry record, then parses it through
`artifactRefSchema`. The resolver names *which* artifacts; the registry decides
*what they are*.

This is the substantive behaviour change. A resolver's claimed `type` and
`metadata` no longer reach downstream nodes — only registered values do.

### 3. Three rejection rules, applied in order

| Rule | Condition |
|---|---|
| `unknown_artifact` | the id names nothing in the registry |
| `missing_version` | the artifact's own `version` has no version record |
| `corrupt_reference` | the reconstructed reference fails `artifactRefSchema` |

Order matters: an id that names nothing cannot have a version, and a version
that cannot be resolved makes the reference meaningless. Each rule short-
circuits to a typed `MaterializationIssue`, so the error names both the
artifact and the rule rather than reporting a generic failure.

Validation is **all-or-nothing**. One bad id fails the whole request and
publishes nothing, so a partly-valid reuse decision leaves no trace — the same
rule the reuse boundary already followed.

### 4. Failure has two channels, deliberately

`ArtifactMaterializationResult.success` is mandated by the contract, but a
boolean carries no diagnostic. `RegistryArtifactMaterializer` therefore
**throws** `ArtifactMaterializationError` (`ERR_ARTIFACT_MATERIALIZATION`)
carrying the node, capability, execution and the full issue list — which is
what §6.3 of the constitution asks of an error.

The engine treats a thrown `DesignFlowError` and a `success: false` result
identically. An implementation may use whichever channel suits it; the bundled
one throws because it has something worth saying.

### 5. Without a materializer, the engine keeps its own check

`artifactMaterializer` is optional on `ExecutionEngineConfig`. When absent the
engine falls back to the existence check it has applied since Stage 23.

Dropping the check when no materializer is configured was rejected outright:
the engine owns integrity, and it does not surrender that because a collaborator
was not supplied. The fallback is weaker than materialization — it validates
existence only, and injects the resolver's reference verbatim — but it is
strictly better than nothing, and it is exactly what shipped before this stage.

So the compatibility guarantee is precise: **configuring a materializer changes
what is injected** (registry values rather than claimed ones) **and what is
rejected** (versions and schema, not just existence). Hosts already reusing
artifacts should expect stricter behaviour, not identical behaviour.

### 6. `artifact.materialized`, emitted by the materializer

Payload `{ nodeId, artifactId, sourceExecutionId? }`, one per artifact, after
the whole set validates.

The materializer publishes it rather than the engine: it holds the request's
`executionId`, and it is the only party that knows each artifact's origin. That
mirrors Stage 22–23, where the component that knows the fact emits the event.

`sourceExecutionId` is reported only when **every** materialized artifact
shares one originating execution. A mixed set omits it — naming one run's id
for artifacts from several would misattribute the others.

Ordering is `artifact.materialized` → `artifact.reused`. Nothing is announced
as reused until it has been proven usable.

## Consequences

- `packages/sdk/src/artifact-materialization.ts` is new; `ExecutionEventType`
  gained `artifact.materialized`. Both additive.
- `packages/core/src/materialization/` is new: `validation.ts` (the three
  rules, as pure functions returning typed issues) and `materializer.ts`.
- Core gained `ArtifactMaterializationError`.
- `ExecutionEngineConfig` gained an optional `artifactMaterializer`; so did
  `ExecutionServiceConfig`. Named optional fields, which is what Stage 24.5's
  refactor made cheap.
- `ExecutionEngine.resolveReuse` now delegates to `materializeReuse`. The
  reuse decision and the artifacts it resolves to are separate steps.
- **Composed workflow nodes remain outside the loop.** `kind: "workflow"` nodes
  still take the artifact-less skip, because `CapabilityReuseRequest` carries a
  `capabilityId` with nothing honest to put in it for a child workflow. The
  incremental loop is complete for capability nodes only.

## Migration Notes

### Nothing is required

Every existing configuration behaves as before. The materializer is opt-in.

### To complete the incremental loop

```ts
import {
  ExecutionService,
  IncrementalExecutionPlannerService,
  RegistryArtifactMaterializer,
} from "@designflow/core";

const artifactStore = new InMemoryArtifactStore({ eventPublisher });

const service = new ExecutionService({
  ...config,
  artifactStore,
  incrementalPlanner: new IncrementalExecutionPlannerService({ ... }),
  reuseResolver,                                  // your cache policy
  artifactMaterializer: new RegistryArtifactMaterializer({
    registry: artifactStore,
    eventPublisher,
  }),
});
```

All three collaborators are needed for a planned skip to behave like a real
execution. Planner alone skips nodes without their artifacts; planner plus
resolver injects unvalidated references; all three inject registry-backed ones.

### Behaviour changes when a materializer is added

Adding one to a host that already reuses artifacts is a **tightening**:

- Downstream nodes receive the registry's `type` and `metadata`, not the
  resolver's. If a resolver was returning approximate references, downstream
  input changes.
- A reuse decision naming an artifact whose version record is missing now
  fails the node. Previously it passed.
- Reuse decisions are still rejected for unknown artifacts, as before.

Reuse becoming *stricter* is the point; verify a resolver returns ids that name
real, fully-versioned artifacts before enabling it.

### For implementers of `ArtifactMaterializer`

- Be read-only. The engine assumes materialization has no side effects and may
  reasonably call it per node per run.
- Validate the whole set before reporting success; partial results are not
  representable.
- Report failure by throwing a `DesignFlowError` (preferred — it carries
  context) or by returning `success: false`. Both fail the node.
- Return references the registry vouches for. Anything you return is injected
  into every dependent node's `parentArtifacts`.
