# ADR: Stage 6 controlled visual correction feedback loop

Status: accepted for the internal Stage 6 workflow

## Boundary

Stage 6 is `design-to-code-feedback-loop`, a separate internal workflow. The
public Stage 1 workflow and the Stage 4/5 implementation workflow remain
unchanged. A durable parent feedback-loop record owns continuation while each
child workflow execution performs one bounded correction iteration. A new child
is created only when the deterministic evaluator returns improvement and the
configured iteration limit permits it; every child requires an independent
exact approval.

## Finding selection

The selector accepts deterministic major or critical findings only when the
report is conclusive, every evidence id is present, the affected component or
frame is identifiable, expected/actual values exist for measured layout/size/
spacing findings, and an explicit file map keeps the change inside the project.
Model-interpreted findings require explicit policy enablement and a confidence
threshold. Renderer failures, missing references, capture errors, secrets,
external dependency failures, and unknown evidence are never actionable.

## Agent and approval

`visual-correction-agent` is a versioned specialized agent with no tools,
filesystem, shell, workflow, or approval access. It returns a Zod-validated
plan and exact bounded content changes, each mapped to finding and evidence
ids. Deterministic validation rejects unknown ids, stale base hashes, path
escapes, symlinks, secrets, binaries, dependency changes, and over-limit
proposals.

The approval policy targets `create-correction-snapshot`. The CLI preview and
the engine approval request therefore sit immediately before the only snapshot
and write path. A rejection never reaches snapshot, application, validation,
or visual revalidation. Approval is bound to project/root/fingerprint,
implementation/report hashes, plan/proposal hashes, findings, file/dependency
counts, commands, viewport/reference configuration, iteration, expiry, and a
protected node id.

## Application, rollback, and validation

The Stage 4 scoped application service is reused. A single snapshot is created
before application; base hashes are checked again at application time. Safe
project-declared commands run with the existing `shell: false` validation
boundary. A required failure rolls the snapshot back and stops the iteration.
No generated correction success artifact is emitted for a failed validation.

## Revalidation and stopping

Stage 5 is invoked directly through the existing browser/evidence/comparison
runtime after mutation. The previous screenshots are invalidated. The
revalidation gate rejects reuse of the prior report and treats a missing or
unchanged report as inconclusive. Resolution, remaining findings, introduced
findings, and pixel metric deltas are compared deterministically. Pass, no
improvement, regression, renderer unavailability, inconclusive evidence,
rejection, validation failure, stale state, and the hard iteration limit stop
the loop. A model judgment alone cannot continue it. The explicit report
injection remains only for deterministic tests.

## Resume and security

Immutable planning inputs may be reused only with matching identity. Approval
consumption, snapshots, writes, commands, rollback, and post-mutation browser
captures are not reusable planning artifacts. The default limits are three
iterations, five files, 200,000 changed bytes, zero dependencies, and five
findings per iteration. Root, secret-path, binary, symlink, shell, and context
budgets are checked at each boundary. No autonomous self-approval exists.

## Limitations

The parent is a durable product-level execution record rather than a new public
Stage 1 worker. Child workflow side effects remain governed by the existing
engine and snapshot transaction boundaries. Browser-backed production
revalidation still depends on Playwright and a local preview server.
