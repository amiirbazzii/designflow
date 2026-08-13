# Visual Validation

**Purpose** — pre-approval visual evaluation: decide, deterministically, how a
rendered implementation differs from its design, and let a model say which of
those differences matter.

**Owns**

- `visual-expectation-compiler.ts` — Blueprint facts → checkable expectations.
  No model. Every expectation carries an `anchor` describing how the host
  intends to identify its element, decided before anything is rendered.
- `element-correspondence.ts` — which rendered element an expectation is
  about: `matched | ambiguous | unmatched`, resolved from host markers, the
  Implementation Map, DOM structure, exact content and (only to break a tie)
  geometry. Two candidates that survive every signal stay ambiguous; nothing
  here picks the nearest or the first.
- `visual-delta-evaluator.ts` — expectations × `RenderedState` → findings with
  `origin: "deterministic"`, each carrying a real measurement. Identification
  happens first: a measurement is only taken once its element is certain, and
  a finding is never more confident than the correspondence underneath it.
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
judgment, added beside the measurements and never over them. Correspondence is
evidence, not judgment: a model asked "which div is the header?" will always
answer, which is exactly the failure mode, so the Critic never sees the
question.

**Tests** — `./test/`.
