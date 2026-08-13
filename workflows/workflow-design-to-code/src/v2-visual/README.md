# V2 Visual Stage (internal)

**Purpose** — make the last two arrows of the V2 chain real:

```
UIBlueprint → ProjectContext → ImplementationMap → Builder proposal
            → RenderedState → VisualDeltaReport
```

Everything before `RenderedState` already produced canonical artifacts. This
stage renders the validated proposal in an isolated workspace and persists both
the render and its evaluation, so the chain is a resolvable lineage in the
artifact store rather than a set of function calls in a unit test.

**Owns**

- `v2-visual-types.ts` — the stage's artifact ids/types and input contract.
- `v2-visual-capabilities.ts` — six capabilities: four that persist the
  canonical V2 inputs, one that renders, one that evaluates.
- `v2-visual-workflow.ts` — the definition and its installable package.

**Boundaries**

- Internal. `designflow run design-engineer` is unchanged and still V1.
- Ends at a persisted report. No approval, no apply, no repair iteration —
  that is V2-6.
- Writes nothing to the user's project. The render happens in a temporary copy
  that the implementation validator always removes.
- The deterministic evaluator and the Visual Critic live in the agents
  package, which this workflow must not import. The evaluator is
  injected through `context.config.visualEvaluator`, exactly as the browser
  renderer already is. Without it the stage still renders and still persists a
  RenderedState.

**Tests** — `./test/`.
