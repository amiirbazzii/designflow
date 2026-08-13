# Visual Validation

**Purpose** — pre-approval visual evaluation: decide, deterministically, how a
rendered implementation differs from its design, and let a model say which of
those differences matter.

**Owns**

- `visual-expectation-compiler.ts` — Blueprint facts → checkable expectations.
  No model. Only elements carrying exact visible copy are anchored, because
  copy is the only correspondence that does not require a guess.
- `visual-delta-evaluator.ts` — expectations × `RenderedState` → findings with
  `origin: "deterministic"`, each carrying a real measurement.
- `visual-critic-agent.ts` / `critic-patch-response-schema.ts` — the Visual
  Critic: severity, priority, user-visible impact, likely cause. It is given
  `findingId`s the host minted and has no field in which to report a
  measurement.
- `critic-patch-merge.ts` — the boundary, enforced: a patch that restates a
  measurement or names an unknown finding is rejected whole, and the merge
  fingerprints the measured fields before and after.
- `visual-delta-report.ts` — the outcome, decided from deterministic findings
  and a declared policy. Model-interpreted findings never move it.
- `visual-validation-agent.ts` — the legacy Stage-5 agent, unchanged, still on
  the post-apply path. Not re-exported from this feature's barrel.

**Does not own** — screenshot capture, DOM/computed-style capture, pixel
comparison, preview lifecycle, or the isolated build. Those are deterministic
and live in `workflows/workflow-design-to-code/src/visual-validation/`
(`render-proposed-state.ts`).

**The division** — a browser can measure a height, a color and a bounding box,
so nothing here asks a model what those are. The model's contribution is
judgment, added beside the measurements and never over them.

**Tests** — `./test/`.
