# ADR: V2 Design-to-Code is the current flagship (V2-8)

Date: 2026-08-15. Status: accepted.

## Decision

**V2 Design-to-Code = CURRENT FLAGSHIP.** The legacy Coordinator-driven
Design-to-Code architecture is **compatibility-only** — retained for
regression coverage, historical execution reads and explicit internal use,
never for the normal path. Documents describing the Coordinator-routed
journey remain valid as history and should be read as describing the
pre-V2-8 architecture.

## The normal path

```
designflow / designflow run design-engineer
  → deterministic product controller (no AI routing decision)
  → design-to-code-v2 (one workflow, one execution, one lineage)
      Figma evidence → UIBlueprint → ProjectContext → ImplementationMap
      → UI Builder → pre-approval render → deterministic evaluation
      → Visual Critic → bounded convergence → exact review
      → human approval → snapshot → apply → validation
```

- **The Coordinator is not part of the normal Design-to-Code execution
  path.** The `design-engineer` worker manifest carries no `agentId`;
  sessions start through `AgentSessionService.startDeterministicSession`,
  and missing information (design, project, destination) is a product
  question, never a model call.
- **Normal AI roles:** Design Interpreter (optional, additive), Project
  Mapper (required), UI Builder (initial + `visual_repair`), Visual Critic
  (advisory). Their profiles — `design-interpreter-default`,
  `project-mapper-default`, `ui-builder-default`, `visual-critic-default` —
  are registered in the composition root like every other profile.
- **No legacy fallback.** A V2 failure (Mapper unavailable, Builder
  exhausted, visual result not finalizable, project drift) is a typed
  product outcome with zero writes. It never retries through the legacy
  specialists (`figma-specification-agent`, `implementation-agent`,
  `visual-validation-agent`, `visual-correction-agent`).
- **Finalization eligibility** (deterministic, owned by the workflow):
  `converged` and `converged_with_findings` may reach approval; every other
  convergence status fails closed before any approval is requested — a
  browser-unavailable render can never silently bypass visual verification.
- The V2 sub-stage workflows (`design-to-code-v2-visual`,
  `design-to-code-v2-convergence`, `design-to-code-v2-finalize`) remain
  internal; users never see workflow ids, and user-facing copy stays
  "Design Engineer" — V2 is an architecture generation, not a product name.

## Enforcement

`flagship-guards.test.ts` fails if flagship sources reference a legacy agent
id or a flagship node invokes a legacy specialist capability;
`flagship-acceptance.test.ts` proves the full session→approval→apply journey
against a host wired with no agent runtime at all.
