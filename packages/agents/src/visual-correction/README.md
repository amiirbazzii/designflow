# Visual Correction

**Purpose** — the agent that turns confirmed visual findings into a bounded
correction proposal.

**Owns** — `visual-correction-agent.ts`, including the discipline that content
hashes are recomputed by the host rather than trusted from the model.

**Does not own** — the feedback-loop workflow, correction preflight,
composition scope or revalidation. Those live in
`workflows/workflow-design-to-code/src/visual-correction/`.

**Migration status** — folds into UI Builder Repair Mode in V2-6. Until then
it is the correction path.

**Tests** — `./test/`.
