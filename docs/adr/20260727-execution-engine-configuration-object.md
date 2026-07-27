# ExecutionEngine Configuration Object

**Date:** 2026-07-27
**Status:** Accepted
**Stage:** 24.5 (cleanup)

## Context

`ExecutionEngine`'s constructor had grown to eight positional parameters, four
of them optional:

```ts
new ExecutionEngine(
  registry, logger, artifactStore, executionRepository, eventPublisher,
  workflowExecutionResolver?, reuseResolver?, incrementalPlanner?,
)
```

The growth was structural, not accidental. Each of Stages 21, 23 and 24 needed
to add a collaborator without breaking existing call sites, and appending an
optional positional is the cheapest way to do that. The cost compounded:

- A call site passing only the third optional had to write
  `undefined, undefined, planner` — placeholder noise that says nothing.
- Adjacent parameters of unrelated types are silently swappable.
  `(registry, logger, artifactStore, repository, eventPublisher)` has no
  positional redundancy to catch a transposition.
- `ExecutionServiceConfig` was *already* a named options object, so the service
  destructured named config and immediately flattened it back into positionals.

The ADRs for Stages 23 and 24 both recorded this as debt and deferred it.
Deferring again would mean Stage 25 adds a ninth parameter.

## Decision

The constructor takes a single `ExecutionEngineConfig`:

```ts
new ExecutionEngine({
  registry, logger, artifactStore, executionRepository, eventPublisher,
  workflowExecutionResolver, reuseResolver, incrementalPlanner,
})
```

Field names match `ExecutionServiceConfig`, so the two configs read the same
and the service's mapping is now a direct name-for-name copy.

### Optional fields accept an explicit `undefined`

The four optional collaborators are typed `?: T | undefined`, not `?: T`.
Under the constitution's mandated `exactOptionalPropertyTypes: true`, `?: T`
would reject a caller that holds the value as `T | undefined` — which is the
normal case, since these are optional collaborators — forcing a conditional
spread at every call site:

```ts
...(planner !== undefined ? { incrementalPlanner: planner } : {})
```

For these fields "absent" and "explicitly undefined" mean the same thing: the
collaborator is not configured. Distinguishing them would buy nothing and cost
a conditional spread everywhere.

### `ExecutionService` constructs through one helper

Both engine construction sites in `ExecutionService` were byte-identical and
had to be edited in lockstep by every stage that added a collaborator — a step
missed on the first pass in both Stage 23 and Stage 24. They now share a
private `createEngine()`, so there is one place to update.

## Consequences

- `ExecutionEngine`'s constructor signature is a **breaking change** for any
  code outside `packages/core` that constructs an engine directly. Nothing
  does: all nine call sites are inside the package (2 production, 7 test), so
  no coordinated release is needed.
- `ExecutionEngineConfig` is exported from `@designflow/core`.
- No behaviour changed. Field-for-field the same values reach the same private
  fields; the test suite is unchanged in content and passes at the same counts
  (341 core, 499 total).
- Adding a collaborator in a future stage is now a named optional field rather
  than a ninth positional.

## Migration Notes

Convert positional construction to a single object. Names are identical to the
former parameter names, so the mapping is mechanical:

```ts
// before
new ExecutionEngine(registry, logger, artifactStore, repository, events);

// after
new ExecutionEngine({
  registry,
  logger,
  artifactStore,
  executionRepository: repository,
  eventPublisher: events,
});
```

Two parameters were named differently at call sites than in the config, and are
the only places a rename is involved: the fourth positional is
`executionRepository` and the fifth is `eventPublisher`.

Placeholder `undefined` arguments simply disappear — omit the field, or pass a
possibly-undefined value directly.

`ExecutionService` users are unaffected: `ExecutionServiceConfig` is unchanged.
