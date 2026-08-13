# Visual Validation

**Purpose** — the agent that interprets deterministic visual evidence and adds
structured findings.

**Owns** — `visual-validation-agent.ts`: the Stage-5 agent contract, its
evidence-reference discipline (a finding must cite evidence it was given) and
its deterministic strategy.

**Does not own** — screenshot capture, DOM/computed-style capture, pixel
comparison or preview lifecycle. Those are deterministic and live in
`workflows/workflow-design-to-code/src/visual-validation/`.

**Migration status** — evolves into the Visual Critic in V2-5; boundaries are
made explicit here first.

**Tests** — `./test/`.
