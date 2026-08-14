# Flagship Design-to-Code (V2-8)

**V2 Design-to-Code is the CURRENT FLAGSHIP.** The legacy Coordinator-driven
Design-to-Code path is compatibility-only.

```
Figma evidence → UIBlueprint → ProjectContext → ImplementationMap
  → UI Builder → bounded visual convergence → exact review
  → human approval → snapshot → apply → validation
```

## What this feature owns

- `design-to-code-v2` — one workflow, one execution, one lineage. The user
  never sees this id; the public identity remains the `design-engineer`
  worker and the `Design Engineer` name.
- The flagship glue capabilities: Blueprint/Context compilation seams, the
  Mapper step with **destination-binding enforcement** (the user's
  destination decision is authority — a plan that contradicts it fails with
  `ERR_DESTINATION_BINDING_MISMATCH` before the Builder runs), the Builder
  step with typed no-fallback failures, and the **finalization-eligibility
  policy**.

## Normal AI roles

`Design Interpreter` (optional, additive) · `Project Mapper` (required) ·
`UI Builder` (initial + `visual_repair`) · `Visual Critic` (advisory).

**The Coordinator is not part of the normal Design-to-Code execution path.**
Neither are the legacy specialists (`figma-specification-agent`,
`implementation-agent`, `visual-validation-agent`, `visual-correction-agent`)
— a guard test fails if any flagship source references them, and V2 failures
never fall back to the legacy path.

## Finalization eligibility (§17)

```
converged                 → finalizable
converged_with_findings   → finalizable, findings shown
everything else           → not finalizable, typed product failure, 0 writes
```

There is no silent visual bypass: a browser-unavailable/inconclusive
convergence stops before approval.

## Seams

`context.config`: `v2BlueprintCompiler`, `v2ProjectContextCompiler`,
`v2ProjectMapper`, `v2UiBuilder`, plus the established `visualRenderer`,
`visualEvaluator`, `visualRepairBuilder`. The CLI composition root wires
production implementations; tests wire deterministic fakes.
