# Visual Convergence (V2-6)

The bounded pre-approval loop:

```
Builder P0 → render → VisualDeltaReport R0
     ↓ repair required, budget remains
Builder repair P1 → render P1 from scratch → R1
     ↓
Builder repair P2 → render P2 from scratch → R2
     ↓
deterministic candidate selection → one selected proposal
```

## The architecture in eleven statements

1. **The Visual Critic diagnoses.** It interprets trusted deterministic
   evidence; it never writes code, produces patches, chooses files, mutates
   the Implementation Map or invokes the Builder.
2. **The UI Builder repairs.** The same agent, same `ui-builder-default`
   profile, in an explicit `visual_repair` mode — not a second code-writing
   agent, and never the legacy Visual Correction agent.
3. **The deterministic host owns iteration.** It validates every proposal,
   renders every state, measures every result and decides whether another
   iteration is allowed. The Builder does not decide it deserves another
   attempt.
4. **The Blueprint and the Implementation Map are immutable.** Design truth
   never moves toward the implementation, and repair means "execute the same
   plan better", never "re-plan". Every repair proposal passes the same map
   enforcement as the initial one.
5. **Every proposal is independently applicable to the original base.**
   Nothing has been applied; a repair proposal bound to a different base
   fingerprint is refused.
6. **Every iteration is freshly rendered.** New isolated workspace, new
   build, new screenshots, new DOM evidence, new correspondence. No evidence
   of P0 is ever treated as measurement of P1.
7. **Deterministic findings drive convergence.** Actionability is a policy
   over the trusted report (`convergence-policy.ts`); Critic prose is
   advisory context, clearly separated from measured facts, and ambiguous
   correspondence never becomes a precise repair instruction.
8. **Candidate selection is deterministic.** A documented lexicographic
   policy (`candidate-selection.ts`, `SELECTION_POLICY_VERSION`).
9. **The last proposal is not automatically best.** A regressing P2 loses to
   a stronger validated P1.
10. **The budget is three evaluated states** (initial + at most two repairs),
    owned by `VISUAL_CONVERGENCE_LIMITS` in the SDK. Configuration can lower
    it, nothing can raise it. This is deliberately not the legacy
    feedback-loop limit, whose post-approval apply semantics do not transfer.
11. **No project mutation before approval.** The run ends at a persisted
    `implementation.visual-convergence` record naming `selectedProposalRef`;
    approval and apply belong to V2-7.

## Seams

The workflow package depends on the SDK alone. The Builder and evaluator are
injected through `context.config`:

- `visualEvaluator` — the deterministic evaluator (+ optional Critic), as in
  the V2-5.1 visual stage.
- `visualRepairBuilder` — one bounded repair build; the composition root wraps
  the agents package's `buildImplementation` with `mode: "visual_repair"`.
- `visualRenderer` — the browser seam, as everywhere else.

## Files

- `visual-convergence-types.ts` — input schema, artifact ids, Builder seam.
- `convergence-policy.ts` — actionable-finding and acceptance policy.
- `finding-comparison.ts` — canonical finding keys and iteration comparison.
- `candidate-selection.ts` — the lexicographic selection policy.
- `repair-evidence.ts` — the bounded, map-scoped repair request compiler.
- `visual-convergence-capability.ts` — the executable bounded loop.
- `visual-convergence-workflow.ts` — the internal workflow definition.
- `convergence-report.ts` — the human-readable projection (not truth).
